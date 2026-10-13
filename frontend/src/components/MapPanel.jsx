import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hasFirebase, db } from '../firebase';
import { collection, query, orderBy, onSnapshot, limit as limitFn } from 'firebase/firestore';

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Status colors and icons
const STATUS_CONFIG = {
  'Verified': { color: '#4CAF50', bgColor: '#E8F5E9', label: '✓ Verified' },
  'Requested': { color: '#2196F3', bgColor: '#E3F2FD', label: '🔧 Repair Requested' },
  'In Progress': { color: '#FF9800', bgColor: '#FFE0B2', label: '🚧 In Progress' },
};

// Get status emoji
const getStatusEmoji = (status) => {
  switch(status) {
    case 'Verified': return '✓';
    case 'Requested': return '🔧';
    case 'In Progress': return '🚧';
    default: return '📍';
  }
};

// Create custom marker icons for each status
const createMarkerIcon = (status) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG['Verified'];
  const emoji = getStatusEmoji(status);
  
  return L.divIcon({
    html: `
      <div style="
        background-color: ${config.color};
        border: 3px solid white;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        cursor: pointer;
      ">
        ${emoji}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
    className: 'leaflet-custom-icon'
  });
};

const formatHazardLabel = (hazardClass = '') => {
  if (!hazardClass) return 'Unknown';
  const normalized = hazardClass.toString().trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'transverse_crack' || normalized === 'transversal_crack') return 'Not Hazard';
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatTimeAgo = (timestamp) => {
  if (!timestamp) return 'Unknown time';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const normalizeStatus = (status) => {
  const normalized = (status || '').toString().trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'pending' || normalized === 'pending verification') return 'Pending';
  if (normalized === 'verified') return 'Verified';
  if (normalized === 'requested' || normalized === 'repair requested') return 'Requested';
  if (normalized === 'in progress' || normalized === 'in_progress') return 'In Progress';
  if (normalized === 'completed' || normalized === 'complete') return 'Completed';
  if (normalized === 'rejected' || normalized === 'reject') return 'Rejected';
  return 'Pending';
};

const MAP_VISIBLE_STATUSES = new Set(['Verified', 'Requested', 'In Progress']);

const MapPanel = ({ isOpen, onClose, API_URL, isMobileView = false }) => {
  const [hazards, setHazards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tileError, setTileError] = useState('');
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const tileErrorCountRef = useRef(0);

  // Fetch verified hazards — prefer Firestore onSnapshot when Firebase config exists,
  // otherwise fall back to REST polling.
  useEffect(() => {
    if (!isOpen) return;

    let unsubscribe = null;
    let pollingInterval = null;

    const applyReportData = (reportData) => {
      let data = Array.isArray(reportData) ? reportData : [];
      data = data.filter(report => {
        const status = normalizeStatus(report?.status);
        return MAP_VISIBLE_STATUSES.has(status);
      }).map(report => ({ ...report, status: normalizeStatus(report?.status) }));
      setHazards(data);
    };

    // Firestore path assumed: collection 'hazard_records' or 'reports' (try both)
    const trySetupFirestoreListener = () => {
      if (!hasFirebase || !db) return false;

      try {
        // prefer collection name 'hazard_records' then 'reports'
        const colNames = ['hazard_records', 'reports'];
        for (const colName of colNames) {
          const q = query(collection(db, colName), orderBy('timestamp', 'desc'), limitFn(500));
          // attach snapshot
          unsubscribe = onSnapshot(q, (snapshot) => {
            const docs = [];
            snapshot.forEach(doc => {
              const d = doc.data();
              // Ensure recordId exists
              d.recordId = d.recordId || doc.id;
              docs.push(d);
            });
            applyReportData(docs);
          }, (err) => {
            console.warn('Firestore onSnapshot error for', colName, err);
            // on error, fall back to REST polling
            if (unsubscribe) { unsubscribe(); unsubscribe = null; }
            setupRestPolling();
          });

          // if we reached here, listener attached
          return true;
        }
      } catch (err) {
        console.warn('Failed to attach Firestore listener:', err && err.message ? err.message : err);
      }
      return false;
    };

    const fetchHazards = async () => {
      try {
        setLoading(true);
        setError('');

        const response = await axios.get(`${API_URL}/reports`, {
          params: { limit: 500 },
          timeout: 10000
        });
        applyReportData(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error('Failed to fetch hazards:', err);
        setError('Failed to load hazards on map');
      } finally {
        setLoading(false);
      }
    };

    const setupRestPolling = () => {
      fetchHazards();
      pollingInterval = setInterval(fetchHazards, 30000);
    };

    // Try Firestore listener first; else fallback to REST
    const ok = trySetupFirestoreListener();
    if (!ok) setupRestPolling();

    return () => {
      if (unsubscribe) try { unsubscribe(); } catch { /* ignore */ }
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [isOpen, API_URL]);

  // Initialize and update map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    // Malaysia bounding box (approx) to keep map focused on Malaysia
    const MALAYSIA_BOUNDS = L.latLngBounds([
      [0.5, 99.0], // southwest (lat, lng)
      [7.9, 119.6] // northeast (lat, lng)
    ]);

    // Initialize map if needed
    if (!mapInstanceRef.current) {
      const center = hazards.length > 0 
        ? [
            hazards.reduce((sum, h) => sum + (Number(h?.location?.latitude) || 0), 0) / hazards.length,
            hazards.reduce((sum, h) => sum + (Number(h?.location?.longitude) || 0), 0) / hazards.length
          ]
        : [4.210484, 101.975769]; // Malaysia center

      mapInstanceRef.current = L.map(mapContainerRef.current, {
        center,
        zoom: 6,
        minZoom: 5,
        maxZoom: 19,
        scrollWheelZoom: true,
        zoomControl: true,
        maxBounds: MALAYSIA_BOUNDS,
        maxBoundsViscosity: 0.8
      });

      // Primary tile provider (OpenStreetMap). We'll attach error listeners and fallbacks.
      const createTileLayer = (url, options = {}) => L.tileLayer(url, Object.assign({
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        crossOrigin: true
      }, options));

      let tile = createTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');

      // Handle tile errors: count and show friendly message, try fallback once
      const handleTileError = () => {
        tileErrorCountRef.current = (tileErrorCountRef.current || 0) + 1;
        if (tileErrorCountRef.current === 1) {
          // try a fallback tile provider
          setTileError('Tile load issue detected. Trying fallback provider...');
          mapInstanceRef.current.removeLayer(tile);
          tile = createTileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png');
          tile.addTo(mapInstanceRef.current);
        } else if (tileErrorCountRef.current > 3) {
          setTileError('Failed to load map tiles. Please check network or try again later.');
        }
      };

      tile.on('tileerror', handleTileError);
      tile.on('load', () => {
        setTileError('');
        // invalidate size to fix tiles not showing when panel is animated
        setTimeout(() => {
          try { mapInstanceRef.current.invalidateSize(); } catch { /* ignore */ }
        }, 250);
      });

      tile.addTo(mapInstanceRef.current);

      // Invalidate size once panel is visible; also on window resize
      setTimeout(() => { try { mapInstanceRef.current.invalidateSize(); } catch { /* ignore */ } }, 300);
      const onResize = () => { try { mapInstanceRef.current.invalidateSize(); } catch { /* ignore */ } };
      window.addEventListener('resize', onResize);
      // store for cleanup
      mapInstanceRef.current.__onResize = onResize;
    } else {
      // If map already exists, ensure size is recalculated when opening
      setTimeout(() => { try { mapInstanceRef.current.invalidateSize(); } catch { /* ignore */ } }, 200);
    }

    // Clear existing markers
    Object.values(markersRef.current).forEach(marker => {
      mapInstanceRef.current.removeLayer(marker);
    });
    markersRef.current = {};

    // Add hazard markers
    hazards.forEach((hazard) => {
      const lat = Number(hazard?.location?.latitude);
      const lng = Number(hazard?.location?.longitude);
      
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const detections = Array.isArray(hazard?.detections) ? hazard.detections : [];
      const topDetection = detections.reduce((best, item) => {
        const bestConf = Number(best?.confidence || 0);
        const itemConf = Number(item?.confidence || 0);
        return itemConf > bestConf ? item : best;
      }, detections[0] || null);

      const popupContent = `
        <div style="min-width: 250px;">
          ${hazard.mediaURL ? `<img src="${hazard.mediaURL}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;" />` : ''}
          <div style="font-weight: bold; margin-bottom: 8px;">
            #${String(hazard.recordId || '').substring(0, 8)}
          </div>
          <div style="margin-bottom: 8px;">
            <span style="background-color: ${STATUS_CONFIG[hazard.status]?.color || '#999'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
              ${STATUS_CONFIG[hazard.status]?.label || hazard.status}
            </span>
          </div>
          <div style="margin-bottom: 8px; font-size: 13px;">
            <strong>Hazard:</strong> ${formatHazardLabel(topDetection?.class || hazard?.finalHazardClass || 'unknown')}
            ${topDetection?.confidence !== undefined ? ` (${(Number(topDetection.confidence || 0) * 100).toFixed(1)}%)` : ''}
          </div>
          <div style="margin-bottom: 8px; font-size: 13px;">
            <strong>Location:</strong> ${hazard?.location?.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
          </div>
          <div style="font-size: 12px; color: #999;">
            ${formatTimeAgo(hazard.timestamp)}
          </div>
          ${hazard?.description ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 12px;"><em>"${hazard.description}"</em></div>` : ''}
        </div>
      `;

      const marker = L.marker([lat, lng], {
        icon: createMarkerIcon(hazard.status)
      })
        .bindPopup(popupContent)
        .addTo(mapInstanceRef.current);

      markersRef.current[hazard.recordId] = marker;
    });

    // Adjust map bounds if hazards exist
    if (hazards.length > 0) {
      const bounds = L.latLngBounds(hazards.map(h => [
        Number(h?.location?.latitude),
        Number(h?.location?.longitude)
      ]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [isOpen, hazards]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        try {
          const onResize = mapInstanceRef.current.__onResize;
          if (onResize) window.removeEventListener('resize', onResize);
        } catch { /* ignore */ }
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Derive a safe tracking start timestamp from hazards or fallback to now
  const trackingStartMs = (() => {
    if (!Array.isArray(hazards) || hazards.length === 0) return Date.now();
    let min = Infinity;
    for (const h of hazards) {
      const tNum = Number(h?.timestamp);
      const t = Number.isFinite(tNum) && tNum > 0 ? tNum : (new Date(h?.timestamp).getTime());
      if (Number.isFinite(t) && !Number.isNaN(t)) min = Math.min(min, t);
    }
    return (min === Infinity ? Date.now() : min);
  })();

  if (!isOpen) return null;

  return (
    <div className="position-fixed top-0 start-0 w-100" style={{ zIndex: 2000, height: '100dvh', minHeight: '100vh' }}>
      {/* Semi-transparent overlay */}
      <div 
        className="position-absolute w-100 h-100" 
        style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />

      {/* Sliding Map Panel */}
      <div 
        className="position-absolute top-0 start-0 h-100 d-flex flex-column bg-white"
        style={{
          width: isMobileView ? '100vw' : '100%',
          maxWidth: isMobileView ? '100vw' : '600px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          animation: 'slideIn 0.3s ease-out',
          zIndex: 2001,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
      >
        {/* Header */}
        <div className="bg-primary text-white d-flex align-items-center justify-content-between shadow-sm" style={{ padding: isMobileView ? '12px 14px' : '12px 16px' }}>
          <h6 className="mb-0 fw-bold" style={{ fontSize: isMobileView ? '0.98rem' : '1rem' }}>🗺️ Hazard Map</h6>
          <button 
            className="btn btn-sm btn-light"
            onClick={onClose}
            style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0 }}
          >
            ✕
          </button>
        </div>

        {/* Map Container */}
        <div className="flex-grow-1 position-relative" style={{ overflow: 'hidden', minHeight: 0 }}>
          {loading && (
            <div className="position-absolute top-50 start-50 translate-middle bg-white rounded shadow p-3" style={{ zIndex: 1500 }}>
              <div className="spinner-border spinner-border-sm text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              <div className="small text-muted mt-2">Loading hazards...</div>
            </div>
          )}

          {error && (
            <div className="alert alert-danger m-3 mb-0">
              <small>{error}</small>
            </div>
          )}

          {tileError && (
            <div className="alert alert-warning m-3 mb-0">
              <small>{tileError}</small>
            </div>
          )}

          {hazards.length === 0 && !loading && (
            <div className="position-absolute top-50 start-50 translate-middle text-center text-muted">
              <div className="mb-2">📍</div>
              <small>No active hazards on the map</small>
            </div>
          )}

          <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />
        </div>

        {/* Footer with legend */}
        <div className="border-top p-3 small" style={{ maxHeight: isMobileView ? '180px' : '150px', overflowY: 'auto' }}>
          <div className="text-muted mb-2" style={{ fontSize: '0.78rem' }}>
            Showing submissions from {new Date(trackingStartMs).toLocaleString()} onward.
          </div>
          <div className="fw-bold mb-2">Status Legend:</div>
          <div className="d-flex flex-column gap-1">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <div key={status} className="d-flex align-items-center gap-2">
                <div 
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: config.color,
                    border: '2px solid white',
                    boxShadow: '0 0 0 1px #ccc'
                  }}
                />
                <small>{config.label} ({hazards.filter(h => h.status === status).length})</small>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(-100%);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default MapPanel;
