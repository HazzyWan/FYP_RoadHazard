import React, { useEffect, useState } from 'react';
import axios from 'axios';
import LoadingText from './common/LoadingText';

const REPORTER_TOKEN_STORAGE_KEY = 'roadhazard_reporter_token';

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

const formatHazardLabel = (hazardClass = '') => {
  if (!hazardClass) return 'Unknown';
  const normalized = hazardClass.toString().trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'transverse_crack' || normalized === 'transversal_crack') return 'Not Hazard';
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatLocationText = (report) => {
  const address = (report?.location?.address || '').trim();
  if (address) return address;
  const lat = report?.location?.latitude;
  const lng = report?.location?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return 'Unknown location';
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

const MySubmissions = ({ setView, API_URL }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reports, setReports] = useState([]);

  const [reporterToken, setReporterToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(REPORTER_TOKEN_STORAGE_KEY) || '';
  });

  const [selectedReport, setSelectedReport] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchMySubmissions = async () => {
      if (!reporterToken) {
        if (!cancelled) {
          setReports([]);
          setLoading(false);
          setError('');
        }
        return;
      }

      try {
        setError('');
        setLoading(true);
        const response = await axios.get(`${API_URL}/my_submissions`, {
          params: { reporterToken },
          timeout: 12000
        });

        if (cancelled) return;
        const incoming = Array.isArray(response?.data?.submissions) ? response.data.submissions : [];
        const normalized = incoming.map((report) => ({
          ...report,
          status: normalizeStatus(report?.status)
        }));
        setReports(normalized);
      } catch (fetchError) {
        if (!cancelled) {
          console.error(fetchError);
          const responseStatus = Number(fetchError?.response?.status || 0);
          const backendData = fetchError?.response?.data || {};
          const errorBlob = [
            backendData?.error,
            backendData?.message,
            fetchError?.message
          ].filter(Boolean).join(' ').toLowerCase();
          const tokenError = errorBlob.includes('reporter token');
          const authLikeStatus = responseStatus === 400 || responseStatus === 401 || responseStatus === 403 || responseStatus === 404;

          // Recovery path: stale token can happen after backend reset or environment changes.
          if (tokenError || authLikeStatus) {
            window.localStorage.removeItem(REPORTER_TOKEN_STORAGE_KEY);
            setReporterToken('');
            setReports([]);
            setError('');
            return;
          }

          setReports([]);
          setError(fetchError?.response?.data?.error || 'Failed to load your submissions.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchMySubmissions();
    return () => {
      cancelled = true;
    };
  }, [API_URL, reporterToken]);

  return (
    <div className="container py-4">
      <div className="bg-primary text-white p-3 rounded-4 shadow-sm d-flex align-items-center justify-content-between mb-3">
        <button className="btn btn-sm btn-outline-light" onClick={() => setView('home')}>← Back</button>
        <h5 className="mb-0 fw-bold">📋 My Submissions</h5>
        <span className="small opacity-75">{reports.length} report(s)</span>
      </div>

      {loading ? (
        <div className="card border-0 shadow-sm p-4 text-muted"><LoadingText>Loading your submissions</LoadingText></div>
      ) : error ? (
        <div className="card border-0 shadow-sm p-4 text-danger">{error}</div>
      ) : reports.length === 0 ? (
        <div className="card border-0 shadow-sm p-4 text-muted">No submissions found on this device yet.</div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {selectedReport && (
            <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{zIndex: 2000}}>
              <div className="position-absolute top-0 start-0 w-100 h-100" style={{backgroundColor: 'rgba(0,0,0,0.45)'}} onClick={() => setSelectedReport(null)}></div>
              <div className="card p-3 shadow-lg" style={{maxWidth: '680px', width: '95%'}}>
                <div className="d-flex mb-2">
                  <img src={selectedReport.mediaURL} alt="submission" style={{width:120,height:120,objectFit:'cover',borderRadius:8}} className="me-3 border" />
                  <div className="flex-grow-1">
                    <div className="d-flex justify-content-between">
                      <strong>#{String(selectedReport.recordId || '').substring(0,8)}</strong>
                      <span className="badge bg-secondary">{selectedReport.status || 'Pending'}</span>
                    </div>
                    <div className="small text-muted">{formatTimeAgo(selectedReport.timestamp)} • {formatLocationText(selectedReport)}</div>
                    <div className="mt-2"><strong>Hazard:</strong> {formatHazardLabel((selectedReport.detections||[])[0]?.class || selectedReport.finalHazardClass || 'unknown')}</div>
                    {selectedReport.description && <div className="mt-2 small text-muted">“{selectedReport.description}”</div>}
                  </div>
                </div>
                <div className="text-end">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedReport(null)}>Close</button>
                </div>
              </div>
            </div>
          )}

          {reports.map((report) => {
            const detections = Array.isArray(report?.detections) ? report.detections : [];
            const topDetection = detections.reduce((best, item) => {
              const bestConf = Number(best?.confidence || 0);
              const itemConf = Number(item?.confidence || 0);
              return itemConf > bestConf ? item : best;
            }, detections[0] || null);

            return (
              <div key={report.recordId} className="card border-0 shadow-sm" role="button" tabIndex={0} onClick={() => setSelectedReport(report)} style={{cursor: 'pointer'}} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedReport(report); }}>
                <div className="card-body">
                  <div className="d-flex gap-3">
                    <img
                      src={report.mediaURL}
                      alt="submission"
                      style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8 }}
                      className="border"
                    />
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between flex-wrap gap-2">
                        <strong>#{String(report.recordId || '').substring(0, 8)}</strong>
                        <span className="badge bg-secondary">{report.status || 'Pending'}</span>
                      </div>
                      <div className="small text-muted">{formatTimeAgo(report.timestamp)} • {formatLocationText(report)}</div>
                      <div className="mt-2 small">
                        <strong>Hazard:</strong> {formatHazardLabel(topDetection?.class || report?.finalHazardClass || 'unknown')}
                        {topDetection?.confidence !== undefined && (
                          <span className="ms-2 text-muted">({(Number(topDetection.confidence || 0) * 100).toFixed(1)}%)</span>
                        )}
                      </div>
                      {report?.description && (
                        <div className="mt-1 small text-muted">“{report.description}”</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MySubmissions;
