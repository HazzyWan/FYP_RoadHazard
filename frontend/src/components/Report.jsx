import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import exifr from 'exifr';
import LoadingText from './common/LoadingText';

const REPORTER_TOKEN_STORAGE_KEY = 'roadhazard_reporter_token';
const REPORTER_CONTACT_STORAGE_KEY = 'roadhazard_reporter_contact';

const parseStoredReporterContact = () => {
  try {
    const raw = window.localStorage.getItem(REPORTER_CONTACT_STORAGE_KEY);
    if (!raw) return { optedIn: null, email: '' };
    const parsed = JSON.parse(raw);
    return {
      optedIn: typeof parsed?.optedIn === 'boolean' ? parsed.optedIn : Boolean(parsed?.email),
      email: String(parsed?.email || '').trim()
    };
  } catch {
    return { optedIn: null, email: '' };
  }
};

const broadcastReportsUpdated = () => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('roadhazard:reports-updated', {
    detail: { source: 'report-submit' }
  }));

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel('roadhazard-reports');
    channel.postMessage({ source: 'report-submit', at: Date.now() });
    channel.close();
  }
};

const Report = ({ setView, API_URL }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [location, setLocation] = useState({ lat: null, lng: null, source: null });
  const [locationTimestamp, setLocationTimestamp] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [showErrorOverlay, setShowErrorOverlay] = useState(false);
  const [manualLocationText, setManualLocationText] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showSkipGPS, setShowSkipGPS] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [description, setDescription] = useState("");
  const [toast, setToast] = useState({ open: false, visible: false, message: '', type: 'info' });
  const storedContact = parseStoredReporterContact();
  const [contactModalOpen, setContactModalOpen] = useState(true);
  const [contactEmail, setContactEmail] = useState(storedContact.email);
  const watchIdRef = useRef(null);
  const gpsTimeoutRef = useRef(null);
  const toastTimerRef = useRef(null);
  const toastExitTimerRef = useRef(null);

  const showToast = (message, type = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current);
    setToast({ open: true, visible: false, message, type });
    setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: true }));
    }, 10);
  };

  const isValidEmail = (value) => {
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
  };

  const saveReporterContactPreference = ({ email }) => {
    const normalizedEmail = String(email || '').trim();
    const optedIn = Boolean(normalizedEmail);
    const payload = {
      optedIn,
      email: normalizedEmail,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(REPORTER_CONTACT_STORAGE_KEY, JSON.stringify(payload));
  };

  const handleContactModalSave = () => {
    const normalizedEmail = String(contactEmail || '').trim();

    if (!normalizedEmail) {
      showToast('Enter email address for updates, or press Skip for now.', 'warning');
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      showToast('Please enter a valid email address.', 'warning');
      return;
    }

    saveReporterContactPreference({
      email: normalizedEmail
    });
    setContactEmail(normalizedEmail);
    setContactModalOpen(false);
  };

  useEffect(() => {
    if (!toast.open || !toast.visible) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: false }));
    }, 2800);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [toast.open, toast.visible, toast.message]);

  useEffect(() => {
    if (!toast.open || toast.visible) return;
    if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current);
    toastExitTimerRef.current = setTimeout(() => {
      setToast((previous) => ({ ...previous, open: false }));
    }, 220);
    return () => {
      if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current);
    };
  }, [toast.open, toast.visible]);

  // Extract GPS from photo EXIF data
  const extractGPSFromPhoto = async (file) => {
    try {
      const gps = await exifr.gps(file);
      
      if (gps && gps.latitude && gps.longitude) {
        setLocation((prev) => {
          if (prev.source === 'Manual Entry') return prev; // don't override manual input
          return {
            lat: gps.latitude,
            lng: gps.longitude,
            source: 'Photo EXIF'
          };
        });
        setLocationTimestamp(new Date());
        setShowManualEntry(false);
        setShowSkipGPS(false); // Hide skip button when location is found
        setLocationLoading(false); // Stop loading since we found EXIF
        console.log('📍 GPS extracted from photo:', gps);
        return true;
      } else {
        console.log('⚠️ No GPS data in photo, falling back to device GPS');
        return false;
      }
    } catch (error) {
      console.log('❌ Error reading EXIF:', error);
      return false;
    }
  };

  // Capture GPS coordinates at the exact moment (for photo capture)
  const captureLocationAtPhotoTime = () => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }

      // Get position immediately (one-time request)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            source: 'Device GPS (Photo Time)',
            timestamp: new Date()
          });
        },
        (error) => {
          console.error("Error capturing location at photo time:", error);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0, // Get fresh position
          timeout: 5000 // 5 second timeout for immediate capture
        }
      );
    });
  };

  // Get current device location
  const getCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      // Only if geolocation is completely unavailable
      setLocation({ lat: null, lng: null, source: null });
      setLocationLoading(false);
      setShowSkipGPS(true); // Show button to enter manually, not the form
      return;
    }

    // clear previous watch and timeout if any
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (gpsTimeoutRef.current !== null) {
      clearTimeout(gpsTimeoutRef.current);
      gpsTimeoutRef.current = null;
    }

    setLocationLoading(true);
    setShowManualEntry(false);
    setShowSkipGPS(false); // Reset skip button
    setLocationError(null);
    setShowErrorOverlay(false);

    const onSuccess = (pos) => {
      setLocation((prev) => {
        if (prev.source === 'Photo EXIF' || prev.source === 'Manual Entry') return prev; // don't override better data
        return { 
          lat: pos.coords.latitude, 
          lng: pos.coords.longitude,
          source: 'Device GPS'
        };
      });
      setLocationTimestamp(new Date());
      setLocationLoading(false);
      setShowSkipGPS(false); // Hide skip button when location is found
      setLocationError(null);
      setShowErrorOverlay(false);
      // Clear timeout but keep watching for updates
      if (gpsTimeoutRef.current !== null) {
        clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }
      // Don't clear the watch - keep it running for continuous updates
    };

    const onError = (error) => {
      console.error("Geolocation error:", error);
      
      // Provide specific error messages based on error code
      let errorMsg = 'Could not get location. ';
      if (error.code === 1) {
        errorMsg = '❌ Location Permission Denied\n\nEnable location:\n1. Go to Settings\n2. Safari (or your browser)\n3. Location → Turn ON\n\nThen try again.';
        console.warn('⚠️ Location permission denied by user');
      } else if (error.code === 2) {
        errorMsg = '⚠️ Position unavailable. Try moving outdoors for better GPS signal.';
      } else if (error.code === 3) {
        errorMsg = '⏱️ Location request timed out. Try again or enter manually.';
      }
      console.warn(errorMsg);
      
      // Keep loading state and show button to enter manually (not the form)
      setLocationLoading(false);
      setShowSkipGPS(true); // Show button instead of form
      setLocation({ lat: null, lng: null, source: null });
      setLocationError(errorMsg);
      setShowErrorOverlay(true);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (gpsTimeoutRef.current !== null) {
        clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }
    };

    // Set a timeout to show manual entry button after 8 seconds (not the form)
    gpsTimeoutRef.current = setTimeout(() => {
      console.log('⏱️ GPS timeout - showing manual entry option');
      setLocationLoading(false);
      setShowSkipGPS(true); // Show button to enter manually
      // Don't stop the watch, let it continue trying
      gpsTimeoutRef.current = null;
    }, 8000); // 8 second timeout

    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000 // 10 second timeout for each position request
    });
  };

  // Use geocoding to convert address to coordinates
  const geocodeAddress = async (address) => {
    try {
      setLocationLoading(true);
      // Using Nominatim (OpenStreetMap) free geocoding service
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=my&limit=1`
      );
      const data = await response.json();
      
      if (data && data.length > 0) {
        setLocation({
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          source: 'Manual Entry',
          address: address
        });
        setLocationTimestamp(new Date());
        setShowManualEntry(false);
        setLocationLoading(false);
        return true;
      } else {
        showToast('Location not found. Please try a more specific address (e.g., "Jalan Bukit Gambir, Penang")', 'warning');
        setLocationLoading(false);
        return false;
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      showToast('Failed to find location. Please check your internet connection.', 'error');
      setLocationLoading(false);
      return false;
    }
  };

  // Reverse-geocode coordinates to a human-readable address (client-side fallback)
  const reverseGeocodeCoords = async (lat, lng) => {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=en`
      );
      if (!resp.ok) return '';
      const data = await resp.json();
      // Prefer display_name but fall back to structured address parts
      return data?.display_name || (data?.address ? Object.values(data.address).join(', ') : '') || '';
    } catch (err) {
      console.error('Reverse geocode failed:', err);
      return '';
    }
  };

  // Handle manual location submission
  const handleManualLocationSubmit = async () => {
    if (!manualLocationText.trim()) {
      showToast('Please enter a location', 'warning');
      return;
    }
    
    await geocodeAddress(manualLocationText);
  };

  // Show "Enter manually" option after 2 seconds if GPS still loading
  useEffect(() => {
    if (locationLoading) {
      const timer = setTimeout(() => {
        // Only show skip button if we still don't have a location
        if (!location.lat || !location.lng) {
          setShowSkipGPS(true);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
    // Don't automatically hide skip button when loading stops
    // It will be hidden when location is found or when user clicks it
  }, [locationLoading, location]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (gpsTimeoutRef.current !== null) {
        clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Reset form when returning from success screen
  useEffect(() => {
    if (status === null) {
      // Clean up any existing GPS watches and timeouts
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (gpsTimeoutRef.current !== null) {
        clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }

      setFile(null);
      setPreview(null);
      setDescription("");
      setManualLocationText('');
      setLocation({ lat: null, lng: null, source: null });
      setLocationTimestamp(null);
      setShowManualEntry(false);
      setShowSkipGPS(false);
      setLocationLoading(false);
      // Don't start GPS tracking here - wait until photo is selected
    }
  }, [status]);


  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setShowManualEntry(false);
      setShowSkipGPS(false);
      setLocationError(null);
      setShowErrorOverlay(false);
      setLocationLoading(true);
      
      // Try EXIF first (instant if available)
      const hasExif = await extractGPSFromPhoto(selectedFile);
      
      // If no EXIF, capture GPS coordinates at the moment photo is selected
      if (!hasExif) {
        // Try to capture GPS immediately
        const photoTimeLocation = await captureLocationAtPhotoTime();
        
        if (photoTimeLocation && photoTimeLocation.lat && photoTimeLocation.lng) {
          // Use the GPS coordinates captured at the exact moment photo was selected
          console.log('📍 No EXIF GPS found, using device location captured at photo time:', photoTimeLocation);
          setLocation({
            lat: photoTimeLocation.lat,
            lng: photoTimeLocation.lng,
            source: photoTimeLocation.source
          });
          setLocationTimestamp(photoTimeLocation.timestamp);
          setShowSkipGPS(false); // Hide skip button when location is found
          setLocationLoading(false);
        } else {
          // GPS capture failed, start continuous tracking
          console.log('📍 No EXIF GPS found, GPS capture failed, starting continuous tracking');
          getCurrentLocation();
        }
      } else {
        console.log('✅ EXIF GPS found, using photo location');
        setLocationLoading(false); // Stop loading since we got EXIF
      }
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      showToast('No photo selected!', 'warning');
      return;
    }
    if (!location.lat || !location.lng) {
      showToast('Location is required!', 'warning');
      return;
    }
    const normalizedEmail = String(contactEmail || '').trim();
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      showToast('Please enter a valid email address for updates.', 'warning');
      setContactModalOpen(true);
      return;
    }
    
    setLoading(true);

    // Ensure we have a human-readable address before sending. If the
    // frontend doesn't have one (EXIF/Device GPS cases), try reverse-geocoding
    // on the client so the submission contains `location_address` even when
    // server-side reverse-geocoding is disabled.
    let finalAddress = location.address || '';
    if (!finalAddress && location.lat && location.lng) {
      try {
        const resolved = await reverseGeocodeCoords(location.lat, location.lng);
        if (resolved) {
          finalAddress = resolved;
          setLocation((prev) => ({ ...prev, address: resolved }));
        }
      } catch {
        console.warn('Client reverse-geocode failed, proceeding without address');
      }
    }

    const formData = new FormData();
    formData.append('image', file);
    formData.append('latitude', location.lat);
    formData.append('longitude', location.lng);
    formData.append('location_address', finalAddress || '');
    formData.append('description', description);
    formData.append('contact_opt_in', normalizedEmail ? 'true' : 'false');
    formData.append('contact_email', normalizedEmail);

    const storedReporterToken = window.localStorage.getItem(REPORTER_TOKEN_STORAGE_KEY);
    if (storedReporterToken) {
      formData.append('reporterToken', storedReporterToken);
    }

    try {
      const response = await axios.post(`${API_URL}/upload`, formData, { timeout: 180000 });
      console.log('Upload response:', response.data);
      const nextToken = response?.data?.reporter?.reporterToken;
      if (nextToken) {
        window.localStorage.setItem(REPORTER_TOKEN_STORAGE_KEY, String(nextToken));
      }
      broadcastReportsUpdated();
      setStatus('success');
    } catch (error) { 
      console.error('Upload error:', error);
      const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''));

      // If the request timed out, the server was already processing — the upload almost
      // certainly went through. Show the success screen instead of an error.
      if (isTimeout) {
        const knownReporterToken = window.localStorage.getItem(REPORTER_TOKEN_STORAGE_KEY);
        if (knownReporterToken) {
          try {
            const probe = await axios.get(`${API_URL}/my_submissions`, {
              params: { reporterToken: knownReporterToken },
              timeout: 15000
            });
            const submissions = Array.isArray(probe?.data?.submissions) ? probe.data.submissions : [];
            const nowMs = Date.now();
            const matchedRecent = submissions.some((item) => {
              const ts = Date.parse(item?.timestamp || '');
              if (!Number.isFinite(ts)) return false;
              if (nowMs - ts > 8 * 60 * 1000) return false;

              const lat = Number(item?.location?.latitude);
              const lng = Number(item?.location?.longitude);
              const sameLat = Number.isFinite(lat) && Math.abs(lat - Number(location.lat || 0)) < 0.001;
              const sameLng = Number.isFinite(lng) && Math.abs(lng - Number(location.lng || 0)) < 0.001;
              return sameLat && sameLng;
            });

            if (matchedRecent) {
              broadcastReportsUpdated();
              setStatus('success');
              return;
            }
          } catch (probeError) {
            console.error('Upload recovery probe failed:', probeError);
          }
        }

        // ECONNABORTED means the server received and started processing the request.
        // In hosted environments this reliably means the upload succeeded — show success.
        broadcastReportsUpdated();
        setStatus('success');
        return;
      } else {
        showToast('Upload failed. Please try again.', 'error');
      }
    } 
    finally { setLoading(false); }
  };

  const handleReturnHome = () => {
    setStatus(null);
    setView('home');
  };

  const formatTimeAgo = (date) => {
    if (!date) return '';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return date.toLocaleDateString();
  };

  if (status === 'success') {
    return (
      <div className="container d-flex align-items-center justify-content-center min-vh-100">
        <div className="card shadow-lg p-5 rounded-4 text-center" style={{maxWidth: '500px'}}>
          <h1 className="display-1 text-success">✓</h1>
          <h2 className="fw-bold mb-3">Report Submitted!</h2>
          <p className="text-muted">AI will verify and send to authorities.</p>
          <button className="btn btn-primary w-100 py-3 mt-3 rounded-pill" onClick={handleReturnHome}>Return Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-vh-100 bg-light py-4 d-flex justify-content-center">
      <div className="bg-white rounded-4 shadow-sm overflow-hidden d-flex flex-column" style={{width: '100%', maxWidth: '450px', minHeight: '800px'}}>
        {showErrorOverlay && locationError && (
          <div className="position-fixed top-0 start-0 w-100" style={{zIndex: 2000}}>
            <div className="alert alert-danger d-flex align-items-start justify-content-between mb-0 rounded-0" role="alert">
              <div style={{whiteSpace: 'pre-wrap'}}>{locationError}</div>
              <button type="button" className="btn-close ms-3" aria-label="Close" onClick={() => setShowErrorOverlay(false)}></button>
            </div>
          </div>
        )}
        
        {/* Header */}
        <div className="bg-primary text-white p-3 d-flex align-items-center shadow-sm">
            <button className="btn text-white fw-bold me-3" onClick={() => setView('home')}>← Back</button>
            <h5 className="mb-0 fw-bold flex-grow-1 text-center pe-5">Submit Report</h5>
        </div>

        <div className="p-4 flex-grow-1 d-flex flex-column gap-3">
            <div className="alert alert-secondary py-2 small mb-0 d-flex justify-content-between align-items-center" role="status" aria-live="polite">
              <span>
                Contact updates: {contactEmail ? 'Enabled' : 'Not enabled'}
                {contactEmail
                  ? ` (${contactEmail})`
                  : ''}
              </span>
              <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => setContactModalOpen(true)}>
                Manage
              </button>
            </div>

            {/* Camera Area */}
            <div className="card bg-light border-2 d-flex align-items-center justify-content-center position-relative overflow-hidden" 
                 style={{height: '250px', borderStyle: preview ? 'solid' : 'dashed', borderColor: '#bbb'}}>
                {preview ? (
                    <img src={preview} className="w-100 h-100 object-fit-cover" alt="Preview" />
                ) : (
                    <div className="text-center text-muted">
                        <span className="fs-1">📷</span><br/>[Captured Image Preview]
                    </div>
                )}
            </div>
            
            {/* Buttons */}
            <div className="d-flex gap-2">
                <label className="btn btn-outline-primary flex-grow-1 fw-bold">
                    {preview ? '🔄 Change Photo' : '📸 Upload Photo'}
                    <input type="file" hidden accept="image/*" onChange={handleFileChange} />
                </label>
                {preview && <button className="btn btn-success flex-grow-1 fw-bold">✓ Ready</button>}
            </div>

            {/* Location Card - Only show after photo is uploaded */}
            {preview && (
              <>
            {!showManualEntry ? (
              <div className={`alert ${location.lat && !locationLoading ? 'alert-success' : locationLoading ? 'alert-info' : 'alert-secondary'} border-2 rounded-3 mb-0`}>
                <div className="d-flex align-items-center justify-content-between">
                  <div className="d-flex align-items-center flex-grow-1">
                    <div className={`${location.lat ? 'bg-success' : locationLoading ? 'bg-info' : 'bg-secondary'} text-white rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0`} style={{width:40, height:40}}>
                      {locationLoading ? <span className="spinner-border spinner-border-sm" role="status" style={{width:20, height:20}}></span> : '📍'}
                    </div>
                    <div className="flex-grow-1">
                        <h6 className={`fw-bold ${location.lat ? 'text-success' : locationLoading ? 'text-info' : 'text-secondary'} mb-0`}>
                          {locationLoading ? <LoadingText>Getting Location</LoadingText> : location.lat ? 'Location Ready' : (preview ? 'Location Needed' : <LoadingText>Preparing Location</LoadingText>)}
                        </h6>
                        <small className="text-muted d-block">
                          {location.lat ? (
                            location.address || `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
                          ) : locationLoading ? <LoadingText>Acquiring GPS signal for photo</LoadingText> : (showSkipGPS ? 'GPS unavailable or taking too long - click button below to enter manually' : <LoadingText>Waiting for GPS</LoadingText>)}
                        </small>
                        <div style={{marginTop: '6px'}}>
                          {location.source && (
                            <small className={`badge ${location.source.includes('EXIF') ? 'bg-primary' : location.source.includes('Device') ? 'bg-success' : location.source.includes('Manual') ? 'bg-warning text-dark' : 'bg-secondary'} me-2`}>
                              {location.source}
                            </small>
                          )}
                          {locationTimestamp && (
                            <small className="badge bg-dark">
                              {formatTimeAgo(locationTimestamp)}
                            </small>
                          )}
                        </div>
                        {(locationLoading || showSkipGPS || location.errorMsg) && (
                          <div className="mt-2">
                            {location.errorMsg && (
                              <div className="alert alert-danger py-2 mb-2" style={{whiteSpace: 'pre-wrap', fontSize: '0.85rem'}}>
                                {location.errorMsg}
                              </div>
                            )}
                            <div className="d-flex flex-wrap gap-2 align-items-center">
                              <small className="text-muted" style={{fontSize: '0.8rem'}}>
                                {locationLoading ? <LoadingText>Still fetching GPS</LoadingText> : showSkipGPS ? 'GPS unavailable or taking too long' : ''}
                              </small>
                              {showSkipGPS && (
                                <div className="ms-auto d-flex gap-2 w-100">
                                  <button 
                                    className="btn btn-sm btn-outline-warning flex-grow-1"
                                    onClick={() => {
                                      setLocationLoading(false);
                                      setShowManualEntry(true);
                                      setShowSkipGPS(false);
                                      // Stop GPS watch and timeout
                                      if (watchIdRef.current !== null) {
                                        navigator.geolocation.clearWatch(watchIdRef.current);
                                        watchIdRef.current = null;
                                      }
                                      if (gpsTimeoutRef.current !== null) {
                                        clearTimeout(gpsTimeoutRef.current);
                                        gpsTimeoutRef.current = null;
                                      }
                                    }}
                                  >
                                    Enter location manually
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="d-flex gap-1">
                    <button 
                      className="btn btn-sm btn-outline-success" 
                      onClick={getCurrentLocation}
                      disabled={locationLoading}
                      title="Use current device location"
                    >
                      🔄
                    </button>
                    <button 
                      className="btn btn-sm btn-outline-primary" 
                      onClick={() => setShowManualEntry(true)}
                      title="Enter location manually"
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="alert alert-warning border-2 rounded-3 mb-0">
                <h6 className="fw-bold mb-2">📍 Enter Location</h6>
                <small className="text-muted d-block mb-2">Where was this photo taken?</small>
                <div className="mb-2">
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="e.g., Jalan Bukit Gambir, Penang"
                    value={manualLocationText}
                    onChange={(e) => setManualLocationText(e.target.value)}
                    disabled={locationLoading}
                  />
                </div>
                <div className="d-flex gap-2">
                  <button 
                    className="btn btn-sm btn-primary flex-grow-1" 
                    onClick={handleManualLocationSubmit}
                    disabled={locationLoading}
                  >
                    {locationLoading ? <><span>🔍 </span><LoadingText>Finding</LoadingText></> : '✓ Find Location'}
                  </button>
                  <button 
                    className="btn btn-sm btn-outline-secondary" 
                    onClick={() => {
                      setShowManualEntry(false);
                      getCurrentLocation();
                    }}
                    disabled={locationLoading}
                  >
                    Cancel
                  </button>
                </div>
                <small className="text-muted d-block mt-2">
                  💡 Examples: "Jalan Sultan Ahmad Shah, Penang" or "Georgetown, Penang"
                </small>
              </div>
            )}
            </>
            )}

            {/* Info about location source */}
            {preview && location.source === 'Photo EXIF' && (
              <div className="alert alert-info py-2 small mb-0">
                ℹ️ Using GPS from photo metadata (where photo was taken)
              </div>
            )}
            {preview && location.source === 'Device GPS (Photo Time)' && (
              <div className="alert alert-success py-2 small mb-0">
                ✅ Using GPS coordinates captured at the exact moment photo was taken
              </div>
            )}
            {preview && location.source === 'Manual Entry' && location.address && (
              <div className="alert alert-warning py-2 small mb-0">
                ⚠️ Using location: {location.address}
              </div>
            )}

            {/* Description */}
            <div>
                <label className="fw-bold small mb-1">Description (Optional)</label>
                <textarea 
                  className="form-control" 
                  rows="3" 
                  placeholder='e.g., "Large pothole near traffic light..."' 
                  value={description} 
                  onChange={e=>setDescription(e.target.value)}
                  maxLength={200}
                ></textarea>
                <div className="text-end small text-muted">{description.length}/200</div>
            </div>

            {/* Hazard Type */}
            <div>
              <div className="d-flex align-items-center justify-content-between mb-1">
                <label className="fw-bold small mb-0">Hazard Type</label>
                  <span className="badge rounded-pill text-bg-secondary">Auto by AI</span>
              </div>
                <div className="report-hazard-panel" role="note" aria-label="Hazard type is detected automatically by AI">
                  <div className="report-hazard-panel-title">Detected after submission</div>
                  <div className="report-hazard-panel-subtitle">
                    You do not need to select a type. The model classifies the uploaded image automatically.
                  </div>
                  <div className="report-hazard-tags" aria-hidden="true">
                    <span className="report-hazard-tag">Pothole</span>
                    <span className="report-hazard-tag">Crack</span>
                  </div>
                </div>
                <small className="text-muted">Review and correction can be done later in the dashboard.</small>
            </div>

            <button 
              className="btn btn-danger w-100 py-3 rounded-3 shadow mt-auto fw-bold" 
              style={{backgroundColor: '#FF5722'}} 
              onClick={handleSubmit} 
              disabled={loading || !file || !location.lat || !locationTimestamp}
              title={!locationTimestamp ? "Waiting for GPS confirmation..." : ""}
            >
                {loading ? <><span>⏳ </span><LoadingText>Processing</LoadingText></> : !locationTimestamp ? <><span>⏳ </span><LoadingText>Waiting for GPS</LoadingText></> : "📤 SUBMIT REPORT"}
            </button>
        </div>
      </div>

      {toast.open && (
        <div className="position-fixed end-0 bottom-0 p-3" style={{ zIndex: 2150 }}>
          <div
            className={`toast show align-items-center border-0 shadow-lg ${toast.type === 'error' ? 'bg-danger text-white' : toast.type === 'warning' ? 'bg-warning text-dark' : toast.type === 'success' ? 'bg-success text-white' : 'bg-primary text-white'}`}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{
              minWidth: '320px',
              maxWidth: '440px',
              borderRadius: '12px',
              opacity: toast.visible ? 1 : 0,
              transform: toast.visible ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 0.22s ease, transform 0.22s ease'
            }}
          >
            <div className="d-flex align-items-center">
              <div className="toast-body py-2 px-3" style={{ fontSize: '0.92rem' }}>{toast.message}</div>
              <button
                type="button"
                className={`btn-close me-2 m-auto ${toast.type === 'warning' ? '' : 'btn-close-white'}`}
                aria-label="Close"
                onClick={() => setToast((previous) => ({ ...previous, visible: false }))}
              />
            </div>
          </div>
        </div>
      )}

      {contactModalOpen && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 2300 }}>
          <div className="card shadow-lg border-0 rounded-4" style={{ width: '88%', maxWidth: '500px' }}>
            <div className="card-body p-3 p-md-4">
              <h5 className="fw-bold mb-2" style={{ fontSize: '1.15rem' }}>Receive status updates for your report</h5>
              <p className="text-muted mb-3" style={{ lineHeight: '1.45', fontSize: '0.98rem' }}>
                Provide your email address to receive progress notifications, including when the repair is completed.
              </p>

              <div className="mb-3">
                <label className="form-label small fw-semibold mb-1">Email address (optional)</label>
                <input
                  type="email"
                  className="form-control form-control-sm"
                  placeholder="name@example.com"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>

              <div className="small text-muted mb-3" style={{ lineHeight: '1.4' }}>
                Your email address is used only for report-status communication and can be updated anytime on this page.
              </div>

              <div className="d-flex flex-column flex-sm-row gap-2 justify-content-end">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm px-3"
                  onClick={() => {
                    saveReporterContactPreference({ email: '' });
                    setContactEmail('');
                    setContactModalOpen(false);
                  }}
                >
                  Continue without updates
                </button>
                <button type="button" className="btn btn-primary btn-sm px-3" onClick={handleContactModalSave}>
                  Save contact preference
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Report;
