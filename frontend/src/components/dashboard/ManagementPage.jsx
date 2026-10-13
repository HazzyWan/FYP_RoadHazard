import React, { memo, useEffect, useRef, useState } from 'react';

import HelpHint from './HelpHint';
import LoadingText from '../common/LoadingText';

const ManagementPage = ({
  activeTab,
  setActiveTab,
  stats,
  reports,
  error,
  loading,
  selectedReport,
  setSelectedReport,
  filters,
  setFilters,
  hazardTypeOptions,
  formatHazardLabel,
  locationFilterOptions,
  feedbackProgress,
  feedbackRemaining,
  lastRetrainLabel,
  lastCompletedLabel,
  cooldownMinutes,
  handleRetrainNow,
  datasetCounts,
  handleDownloadCorrectedLabelsZip,
  datasetZipDownloading,
  normalizeStatus,
  formatLocationText,
  formatTimeAgo,
  getHazardBadgeClass,
  hasBoundingBoxes,
  detectionsWithBbox,
  hazardColor,
  percent,
  selectedDetections,
  selectedStatus,
  isSelectedRejected,
  feedbackCorrect,
  setFeedbackCorrect,
  setFeedbackTouched,
  feedbackSaving,
  targetDetectionIndex,
  setTargetDetectionIndex,
  setManualTargetBbox,
  manualTargetBboxes = [],
  setManualTargetBboxes,
  manualHazardClass,
  setManualHazardClass,
  MANUAL_HAZARD_OPTIONS,
  feedbackNote,
  setFeedbackNote,
  handleFeedbackSubmit,
  feedbackTouched,
  handleStatusUpdate,
  handleMapView,
  handleSendRepairRequest,
  handleSimulatePartnerUpdate,
  darkMode,
  isMobileView = false
}) => {
  const imageWrapperRef = useRef(null);
  const drawingStartRef = useRef(null);
  const [bboxDrawMode, setBboxDrawMode] = useState(false);
  const [bboxDraft, setBboxDraft] = useState(null);
  const [hoveredTopTab, setHoveredTopTab] = useState('');

  const panelStyle = {
    backgroundColor: darkMode ? '#1e2540' : '#ffffff',
    border: `1px solid ${darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0'}`,
    borderRadius: '14px',
    boxShadow: darkMode ? '0 10px 30px rgba(0, 0, 0, 0.28)' : '0 6px 20px rgba(15, 23, 42, 0.05)'
  };

  const tabButtonStyle = (tabKey, isActive) => {
    const isHovered = hoveredTopTab === tabKey;
    return {
      border: darkMode
        ? (isActive ? '1px solid rgba(96,165,250,0.45)' : '1px solid transparent')
        : '1px solid',
      borderColor: isActive
        ? (darkMode ? '#3b82f6' : '#bfdbfe')
        : (isHovered ? (darkMode ? 'rgba(148,163,184,0.45)' : '#cbd5e1') : (darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0')),
      backgroundColor: isActive
        ? (darkMode ? 'rgba(59,130,246,0.2)' : '#eff6ff')
        : (isHovered ? (darkMode ? '#25304a' : '#f8fafc') : (darkMode ? '#1e2540' : '#ffffff')),
      color: isActive ? (darkMode ? '#93c5fd' : '#1d4ed8') : (isHovered ? (darkMode ? '#e2e8f0' : '#334155') : (darkMode ? '#cbd5e1' : '#475569')),
      borderRadius: '10px 10px 0 0',
      fontWeight: 700,
      padding: isMobileView ? '8px 12px' : '10px 16px',
      lineHeight: 1.1,
      minWidth: isMobileView ? '116px' : '160px',
      transition: 'all 0.18s ease',
      transform: isHovered && !isActive ? 'translateY(-1px)' : 'translateY(0)',
      boxShadow: darkMode
        ? (isActive
            ? '0 6px 16px rgba(59,130,246,0.16)'
            : (isHovered ? '0 6px 16px rgba(0, 0, 0, 0.22)' : 'none'))
        : (isHovered ? '0 4px 12px rgba(15, 23, 42, 0.06)' : 'none')
    };
  };

  const topTabs = [
    { key: 'All', label: 'All', count: stats.all },
    { key: 'Pending', label: 'Pending', count: stats.pending },
    { key: 'Verified', label: 'Verified', count: stats.verified },
    { key: 'Requested', label: 'Requested', count: stats.requested || 0 },
    { key: 'In Progress', label: 'In Progress', count: stats.inProgress },
    { key: 'Completed', label: 'Completed', count: stats.completed },
    { key: 'Rejected', label: 'Rejected', count: stats.rejected }
  ];

  const tabDescriptions = {
    All: 'Shows every report in one place so you can scan the full workflow.',
    Pending: 'New reports waiting for review, verification, or correction.',
    Verified: 'Reports that have been checked and accepted by the admin team.',
    Requested: 'Verified reports that were sent out as repair requests to a contractor.',
    'In Progress': 'Requests the contractor has accepted and is currently working on.',
    Completed: 'Reports marked as fixed or completed after contractor follow-up.',
    Rejected: 'Reports that were dismissed or marked as not requiring action.'
  };

  const formatCoordinates = (location) => {
    if (!location) return 'Unknown';
    if (typeof location === 'string') return location;
    const lat = Number(location.latitude ?? location.lat);
    const lng = Number(location.longitude ?? location.lng ?? location.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Unknown';
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  };

  const toPercent = (value) => `${(Math.max(0, Math.min(1, Number(value) || 0)) * 100).toFixed(3)}%`;

  const normalizeBox = (box) => {
    if (!box || typeof box !== 'object') return null;
    const x = Math.max(0, Math.min(1, Number(box.x) || 0));
    const y = Math.max(0, Math.min(1, Number(box.y) || 0));
    const width = Math.max(0, Math.min(1, Number(box.width) || 0));
    const height = Math.max(0, Math.min(1, Number(box.height) || 0));
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  };

  const getNormalizedPointer = (event) => {
    const wrapper = imageWrapperRef.current;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const manualBboxEditable = !feedbackCorrect && !feedbackSaving && !feedbackProgress.running;

  useEffect(() => {
    if (feedbackCorrect) {
      setBboxDrawMode(false);
      setBboxDraft(null);
      drawingStartRef.current = null;
      setManualTargetBboxes([]);
      setManualTargetBbox(null);
    }
  }, [feedbackCorrect]);

  useEffect(() => {
    setBboxDrawMode(false);
    setBboxDraft(null);
    drawingStartRef.current = null;
    setManualTargetBboxes([]);
    setManualTargetBbox(null);
  }, [selectedReport?.recordId]);

  const beginDraw = (event) => {
    if (!bboxDrawMode || !manualBboxEditable) return;
    const point = getNormalizedPointer(event);
    if (!point) return;
    drawingStartRef.current = point;
    setBboxDraft({ x: point.x, y: point.y, width: 0, height: 0 });
    event.preventDefault();
  };

  const updateDraw = (event) => {
    if (!bboxDrawMode || !manualBboxEditable || !drawingStartRef.current) return;
    const start = drawingStartRef.current;
    const current = getNormalizedPointer(event);
    if (!current) return;
    const next = normalizeBox({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y)
    });
    if (next) setBboxDraft(next);
  };

  const endDraw = () => {
    if (!bboxDrawMode || !manualBboxEditable || !drawingStartRef.current) return;
    drawingStartRef.current = null;
    const finalized = normalizeBox(bboxDraft);
    setBboxDraft(null);
    if (finalized && finalized.width >= 0.01 && finalized.height >= 0.01) {
      const nextBoxes = [...(Array.isArray(manualTargetBboxes) ? manualTargetBboxes : []), finalized];
      setManualTargetBboxes(nextBoxes);
      setManualTargetBbox(finalized);
      setFeedbackTouched(true);
    }
  };

  const clearManualBoxes = () => {
    setManualTargetBboxes([]);
    setManualTargetBbox(null);
    setFeedbackTouched(true);
  };

  const removeLastManualBox = () => {
    const currentBoxes = Array.isArray(manualTargetBboxes) ? manualTargetBboxes : [];
    if (currentBoxes.length === 0) return;
    const nextBoxes = currentBoxes.slice(0, -1);
    setManualTargetBboxes(nextBoxes);
    setManualTargetBbox(nextBoxes[nextBoxes.length - 1] || null);
    setFeedbackTouched(true);
  };

  return (
  <>
    <div
      className="border-bottom px-2 px-md-4 pt-3 d-flex gap-2 flex-shrink-0 flex-nowrap overflow-auto"
      style={{
        backgroundColor: darkMode ? '#1b2238' : '#f8fafc',
        borderBottomColor: darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      {topTabs.map((tab) => (
        <button
          key={tab.key}
          className="btn"
          style={tabButtonStyle(tab.key, activeTab === tab.key)}
          onMouseEnter={() => setHoveredTopTab(tab.key)}
          onMouseLeave={() => setHoveredTopTab('')}
          onClick={() => setActiveTab(tab.key)}
        >
          {tab.label} ({tab.count})
        </button>
      ))}
    </div>

    <div className="px-3 px-md-4 py-3 border-bottom" style={{ backgroundColor: darkMode ? '#172033' : '#fff' }}>
      <div
        className="rounded-3 p-3"
        style={{
          border: `1px solid ${darkMode ? 'rgba(96,165,250,0.35)' : '#bfdbfe'}`,
          background: darkMode ? 'rgba(30,58,138,0.22)' : '#eff6ff'
        }}
      >
        <div className="d-flex align-items-center gap-2 mb-1">
          <span
            className="px-2 py-1 rounded-pill fw-bold"
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.35px',
              color: darkMode ? '#bfdbfe' : '#1d4ed8',
              background: darkMode ? 'rgba(147,197,253,0.16)' : 'rgba(191,219,254,0.7)'
            }}
          >
            ACTIVE TAB
          </span>
          <strong style={{ color: darkMode ? '#f8fafc' : '#0f172a' }}>{activeTab}</strong>
        </div>
        <div className="small" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>
          {tabDescriptions[activeTab] || 'Choose a status tab to see its report group.'}
        </div>
      </div>
    </div>

    <div
      className="container-fluid flex-grow-1 overflow-hidden p-3"
      style={{ height: 'clamp(520px, calc(100vh - 170px), 920px)' }}
    >
      <div className="row h-100 g-3" style={{ minHeight: 0 }}>
        <div className="col-2 h-100 d-none d-xl-block" style={{ minHeight: 0 }}>
          <div className="p-3 h-100 d-flex flex-column overflow-auto" style={panelStyle}>
            <h6 className="fw-bold text-center mb-3 flex-shrink-0 d-flex align-items-center justify-content-center gap-2" style={{ color: darkMode ? '#e2e8f0' : '#0f172a' }}>
              <span>Filters</span>
              <HelpHint darkMode={darkMode} text="Narrow report results by status, hazard type, and location." />
            </h6>

            <div className="mb-3 flex-shrink-0">
              <label className="fw-bold text-secondary small">Status</label>
              <select className="form-select form-select-sm" value={activeTab} onChange={(e) => setActiveTab(e.target.value)}>
                <option>All</option>
                <option>Pending</option>
                <option>Verified</option>
                <option>Requested</option>
                <option>In Progress</option>
                <option>Completed</option>
                <option>Rejected</option>
              </select>
            </div>
            <div className="mb-3 flex-shrink-0">
              <label className="fw-bold text-secondary small">Hazard Type</label>
              <select
                className="form-select form-select-sm"
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              >
                <option>All Types</option>
                {hazardTypeOptions.map((hazardType) => (
                  <option key={hazardType} value={hazardType}>
                    {formatHazardLabel(hazardType)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-3 flex-shrink-0">
              <label className="fw-bold text-secondary small">Location</label>
              <select
                className="form-select form-select-sm"
                value={filters.location}
                onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              >
                <option>All states</option>
                {locationFilterOptions.map((locationOption) => (
                  <option key={locationOption} value={locationOption}>{locationOption}</option>
                ))}
              </select>
            </div>

            <hr className="my-3 flex-shrink-0" />
            <h6 className="fw-bold text-center text-dark mb-3 flex-shrink-0 d-flex align-items-center justify-content-center gap-2">
              <span>Summary</span>
              <HelpHint darkMode={darkMode} text="Quick confidence breakdown of loaded reports by severity tiers." />
            </h6>

            <div className="flex-shrink-0">
              <div className="bg-success bg-opacity-10 border border-success p-2 rounded text-center mb-2">
                <h3 className="fw-bold text-success mb-0">{stats.high}</h3>
                <small className="text-dark fw-bold" style={{ fontSize: '0.7rem' }}>High / Acceptable (≥70%)</small>
              </div>
              <div className="bg-warning bg-opacity-10 border border-warning p-2 rounded text-center mb-2">
                <h3 className="fw-bold text-warning mb-0" style={{ color: '#E65100' }}>{stats.medium}</h3>
                <small className="text-dark fw-bold" style={{ fontSize: '0.7rem' }}>Medium (≥40% and &lt;70%)</small>
              </div>
              <div className="bg-danger bg-opacity-10 border border-danger p-2 rounded text-center mb-2">
                <h3 className="fw-bold text-danger mb-0">{stats.low}</h3>
                <small className="text-dark fw-bold" style={{ fontSize: '0.7rem' }}>Low (&lt;40% or no detection)</small>
              </div>

              <hr className="my-3" />
              <h6 className="fw-bold text-center text-dark mb-2 d-flex align-items-center justify-content-center gap-2">
                <span>Feedback Progress</span>
                <HelpHint darkMode={darkMode} text="Tracks correction backlog and retraining readiness for model improvements." />
              </h6>
              <div className="border rounded p-2 bg-light mb-2">
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Pending corrections</span>
                  <strong>{feedbackProgress.loaded ? feedbackProgress.pendingFeedbackCount : '--'}</strong>
                </div>
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Retrain threshold</span>
                  <strong>{feedbackProgress.loaded ? feedbackProgress.minFeedback : '--'}</strong>
                </div>
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Remaining</span>
                  <strong>{feedbackProgress.loaded ? feedbackRemaining : '--'}</strong>
                </div>
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Last trigger</span>
                  <strong>{feedbackProgress.loaded ? lastRetrainLabel : '--'}</strong>
                </div>
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Last completed</span>
                  <strong>{feedbackProgress.loaded ? lastCompletedLabel : '--'}</strong>
                </div>
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Cooldown</span>
                  <strong>{feedbackProgress.loaded ? (cooldownMinutes > 0 ? `${cooldownMinutes} min` : 'Ready') : '--'}</strong>
                </div>
                <div className="mt-2">
                  {!feedbackProgress.loaded && <span className="badge bg-secondary">Status unavailable</span>}
                  {feedbackProgress.running && <span className="badge bg-primary">Retrain running</span>}
                  {!feedbackProgress.running && feedbackProgress.lastState === 'completed' && <span className="badge bg-success">Retrain completed</span>}
                  {!feedbackProgress.running && feedbackProgress.ready && <span className="badge bg-success">Retrain ready</span>}
                  {feedbackProgress.loaded && !feedbackProgress.running && !feedbackProgress.ready && <span className="badge bg-secondary">Collecting feedback</span>}
                  {feedbackProgress.loaded && !feedbackProgress.enabled && <span className="badge bg-warning text-dark ms-1">Auto retrain off</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mt-2 w-100"
                  onClick={handleRetrainNow}
                  disabled={!feedbackProgress.loaded || feedbackProgress.running}
                >
                  Start Retrain Now
                </button>
              </div>

              <h6 className="fw-bold text-center text-dark mb-2 d-flex align-items-center justify-content-center gap-2">
                <span>Dataset Labels</span>
                <HelpHint darkMode={darkMode} text="Shows class counts in local archive and available corrected-label export." />
              </h6>
              <div className="border rounded p-2 bg-light mb-2">
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Downloadable images (local archive)</span>
                  <strong>{datasetCounts.loaded ? datasetCounts.totalImages : '--'}</strong>
                </div>
                <div className="small d-flex justify-content-between">
                  <span className="text-muted">Reports with media (Firestore)</span>
                  <strong>{datasetCounts.loaded ? datasetCounts.reportTotalImages : '--'}</strong>
                </div>
                {datasetCounts.loaded && Number(datasetCounts.missingArchivedImages || 0) > 0 && (
                  <div className="small text-warning mt-1">
                    {datasetCounts.missingArchivedImages} report image(s) are missing from local archive, so ZIP/training may include fewer files.
                  </div>
                )}
                {['pothole', 'alligator_crack', 'longitudinal_crack', 'crack', 'not_hazard'].map((hazardClass) => (
                  <div key={hazardClass} className="small d-flex justify-content-between">
                    <span className="text-muted">{formatHazardLabel(hazardClass)}</span>
                    <strong>{datasetCounts.loaded ? (datasetCounts.counts?.[hazardClass] || 0) : '--'}</strong>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary mt-2 w-100"
                  onClick={handleDownloadCorrectedLabelsZip}
                  disabled={datasetZipDownloading}
                >
                  {datasetZipDownloading ? <LoadingText>Preparing ZIP</LoadingText> : 'Download Corrected Labels ZIP'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-4 col-xl-3 h-100" style={{ minHeight: 0 }}>
          <div className="h-100 d-flex flex-column" style={panelStyle}>
            <div className="p-2 border-bottom text-center small fw-bold d-flex align-items-center justify-content-center gap-2" style={{ color: darkMode ? '#cbd5e1' : '#475569', backgroundColor: darkMode ? '#1b2238' : '#f8fafc', borderBottomColor: darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0' }}>
              <span>{activeTab} Reports ({reports.length})</span>
              <HelpHint darkMode={darkMode} text="Inbox of reports for the selected status filter. Click one to inspect and act." />
            </div>
            <div className="overflow-auto flex-grow-1">
              {error && <div className="p-3 text-center text-danger small">{error}</div>}
              {loading && !error && <div className="p-4 text-center text-muted"><LoadingText>Loading reports</LoadingText></div>}
              {!loading && !error && reports.map((report) => {
                const detections = report.detections || [];
                const reportStatus = normalizeStatus(report?.status);
                const statusBadge = (() => {
                  if (reportStatus === 'Requested') return { label: 'Requested', className: 'bg-info text-dark' };
                  if (reportStatus === 'In Progress') return { label: 'In Progress', className: 'bg-warning text-dark' };
                  if (reportStatus === 'Completed') return { label: 'Completed', className: 'bg-success' };
                  if (reportStatus === 'Rejected') return { label: 'Rejected', className: 'bg-danger' };
                  return null;
                })();
                const topDetection = detections.reduce((best, d) => {
                  const bestConf = best?.confidence ?? 0;
                  const currConf = d?.confidence ?? 0;
                  return currConf > bestConf ? d : best;
                }, detections[0] || { class: 'Unknown', confidence: 0 });
                const confidence = (topDetection.confidence ?? 0) * 100;
                const locationLabel = formatLocationText(report);
                const timeLabel = formatTimeAgo(report.timestamp);

                const recordIdLabel = String(report?.recordId || '').slice(0, 4) || '----';

                return (
                  <div
                    key={report.recordId}
                    className="p-3 border-bottom d-flex align-items-center"
                    style={{
                      cursor: 'pointer',
                      minHeight: '80px',
                      maxHeight: '80px',
                      overflow: 'hidden',
                      backgroundColor: selectedReport?.recordId === report.recordId
                        ? (darkMode ? 'rgba(59,130,246,0.18)' : '#eef6ff')
                        : (darkMode ? '#1e2540' : '#ffffff'),
                      borderBottomColor: darkMode ? 'rgba(148,163,184,0.22)' : '#e2e8f0',
                      transition: 'background-color 0.16s ease'
                    }}
                    onClick={() => setSelectedReport(report)}
                  >
                    <img src={report.mediaURL} alt="hazard" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} className="border" />
                    <div className="ms-3 flex-grow-1 overflow-hidden">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <div className="d-flex gap-1 overflow-hidden" style={{ maxWidth: '75%' }}>
                          {statusBadge && (
                            <span className={`badge ${statusBadge.className}`} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {statusBadge.label}
                            </span>
                          )}
                          {detections.length === 0 && <span className="badge bg-secondary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>No Detection</span>}
                          {detections.slice(0, 1).map((d, idx) => (
                            <span key={idx} className={`badge ${getHazardBadgeClass(d.class)}`} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {formatHazardLabel(d.class)} {((d.confidence ?? 0) * 100).toFixed(0)}%
                            </span>
                          ))}
                          {detections.length > 1 && <span className="badge bg-light text-secondary border" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>+{detections.length - 1}</span>}
                        </div>
                        <span className={`fw-bold small flex-shrink-0 ms-1 ${confidence >= 70 ? 'text-success' : confidence >= 40 ? 'text-warning' : 'text-danger'}`}>
                          {confidence.toFixed(0)}%
                        </span>
                      </div>
                      <div className="small text-truncate fw-bold text-dark">{locationLabel}</div>
                      <div className="small text-muted text-truncate">{timeLabel} • #RH-{recordIdLabel}</div>
                    </div>
                  </div>
                );
              })}
              {!loading && !error && reports.length === 0 && <div className="p-5 text-center text-muted">No {activeTab.toLowerCase()} reports.</div>}
            </div>
          </div>
        </div>

        <div className="col-md-8 col-xl-7 h-100" style={{ minHeight: 0 }}>
          {selectedReport ? (
            <div className="h-100 p-0 overflow-auto d-flex flex-column" style={panelStyle}>
              <div className="p-3 border-bottom fw-bold d-flex justify-content-between" style={{ color: darkMode ? '#e2e8f0' : '#0f172a', backgroundColor: darkMode ? '#1b2238' : '#f8fafc', borderBottomColor: darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0' }}>
                <span className="d-inline-flex align-items-center gap-2">
                  <span>Report Details</span>
                  <HelpHint darkMode={darkMode} text="Main workspace for detections, location, workflow state, and review actions." />
                </span>
                <span className="text-muted small">Record: #{selectedReport.recordId}</span>
              </div>
              {feedbackProgress.running && (
                <div className="alert alert-warning rounded-0 border-0 border-bottom mb-0 py-2 px-3">
                  <strong>Retraining in progress.</strong> Please avoid verify/reject/correction actions until training completes.
                </div>
              )}

              <div className="row g-0 h-100">
                <div
                  className="col-lg-12 bg-light border-bottom d-flex align-items-center justify-content-center position-relative overflow-auto p-2"
                  style={{ minHeight: '280px' }}
                >
                  <div
                    ref={imageWrapperRef}
                    className="report-image-wrapper"
                    onMouseDown={beginDraw}
                    onMouseMove={updateDraw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    style={{ cursor: bboxDrawMode && manualBboxEditable ? 'crosshair' : 'default' }}
                  >
                    <img
                      src={selectedReport.mediaURL}
                      className="report-image"
                      alt="Report"
                    />
                    {hasBoundingBoxes && detectionsWithBbox.map((d, idx) => {
                      const color = hazardColor(d.class);
                      const bbox = d.normalizedBbox || {};
                      const left = percent(bbox.x);
                      const top = percent(bbox.y);
                      const width = percent(bbox.width);
                      const height = percent(bbox.height);
                      return (
                        <div
                          key={idx}
                          className="bbox-overlay"
                          style={{
                            left,
                            top,
                            width,
                            height,
                            minWidth: '12px',
                            minHeight: '12px',
                            borderColor: color,
                            boxShadow: `0 0 12px ${color}55`
                          }}
                        >
                          <span
                            className="bbox-label"
                            style={{ backgroundColor: color }}
                          >
                            {formatHazardLabel(d.class || 'unknown')} {((d.confidence ?? 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                    {Array.isArray(manualTargetBboxes) && manualTargetBboxes.map((manualBox, index) => (
                      <div
                        key={`manual-box-${index}`}
                        className="bbox-overlay"
                        style={{
                          left: toPercent(manualBox.x),
                          top: toPercent(manualBox.y),
                          width: toPercent(manualBox.width),
                          height: toPercent(manualBox.height),
                          minWidth: '12px',
                          minHeight: '12px',
                          borderColor: index % 2 === 0 ? '#ff6f00' : '#f97316',
                          borderStyle: 'dashed',
                          boxShadow: '0 0 12px rgba(255,111,0,0.35)'
                        }}
                      >
                        <span className="bbox-label" style={{ backgroundColor: index % 2 === 0 ? '#ff6f00' : '#f97316' }}>
                          Manual box {index + 1}
                        </span>
                      </div>
                    ))}
                    {bboxDraft && bboxDrawMode && (
                      <div
                        className="bbox-overlay"
                        style={{
                          left: toPercent(bboxDraft.x),
                          top: toPercent(bboxDraft.y),
                          width: toPercent(bboxDraft.width),
                          height: toPercent(bboxDraft.height),
                          minWidth: '12px',
                          minHeight: '12px',
                          borderColor: '#ff9800',
                          borderStyle: 'dotted',
                          boxShadow: '0 0 10px rgba(255,152,0,0.45)'
                        }}
                      >
                        <span className="bbox-label" style={{ backgroundColor: '#ff9800' }}>
                          Drawing...
                        </span>
                      </div>
                    )}
                    {!hasBoundingBoxes && (
                      <div className="bbox-empty">No bounding boxes available</div>
                    )}
                  </div>
                </div>

                <div className="col-lg-12 p-4">
                  <div className="row">
                    <div className="col-md-7">
                      <p className="mb-2"><strong>Detections:</strong></p>
                      <div className="d-flex flex-wrap gap-2 mb-2">
                        {selectedDetections.map((d, idx) => (
                          <span key={idx} className={`badge ${getHazardBadgeClass(d.class)}`}>
                            {formatHazardLabel(d.class)} {((d.confidence ?? 0) * 100).toFixed(1)}%
                          </span>
                        ))}
                        {selectedDetections.length === 0 && <span className="badge bg-secondary">No Detection</span>}
                      </div>
                      <p className="mb-2"><strong>Location:</strong> {formatLocationText(selectedReport)}</p>
                      <p className="mb-2"><strong>GPS:</strong> {formatCoordinates(selectedReport.location)}</p>
                      <p className="mb-2"><strong>Status:</strong> <span className={`badge ${selectedStatus === 'Verified' ? 'bg-success' : selectedStatus === 'Requested' ? 'bg-info text-dark' : selectedStatus === 'In Progress' ? 'bg-primary' : selectedStatus === 'Completed' ? 'bg-dark' : selectedStatus === 'Rejected' ? 'bg-danger' : 'bg-warning text-dark'}`}>{selectedStatus || 'Pending Verification'}</span></p>
                      {selectedReport.repairWorkflow && (() => {
                        const wf = selectedReport.repairWorkflow;
                        const contractorNote = wf.contractorNote || wf.completionNote || '';
                        const contractorPhotoURL = wf.contractorPhotoURL || wf.completedPhotoURL || '';
                        const hasContractorUpdate = !!(contractorNote || contractorPhotoURL);
                        const wfState = wf.state || selectedStatus;
                        return (
                          <div className="mt-3">
                            {/* Contractor update card — shown prominently at top when contractor has responded */}
                            {hasContractorUpdate && (
                              <div className="rounded-3 p-3 mb-2" style={{
                                background: darkMode ? 'rgba(34,197,94,0.10)' : '#f0fdf4',
                                border: `1.5px solid ${darkMode ? 'rgba(34,197,94,0.35)' : '#86efac'}`,
                              }}>
                                <div className="fw-bold mb-2 d-flex align-items-center gap-2" style={{ color: darkMode ? '#86efac' : '#15803d', fontSize: '0.92rem' }}>
                                  <span>✅ Contractor Response</span>
                                </div>
                                {contractorNote && (
                                  <div className="mb-2">
                                    <div className="small fw-semibold mb-1" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>Note from Contractor</div>
                                    <div className="small p-2 rounded" style={{
                                      background: darkMode ? 'rgba(255,255,255,0.06)' : '#ffffff',
                                      border: `1px solid ${darkMode ? 'rgba(148,163,184,0.2)' : '#d1fae5'}`,
                                      color: darkMode ? '#e2e8f0' : '#1f2937',
                                      fontStyle: 'italic'
                                    }}>
                                      "{contractorNote}"
                                    </div>
                                  </div>
                                )}
                                {contractorPhotoURL && (
                                  <div>
                                    <div className="small fw-semibold mb-1" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>Completion Photo</div>
                                    <img
                                      src={contractorPhotoURL}
                                      alt="Contractor completion photo"
                                      className="img-fluid rounded"
                                      style={{
                                        maxHeight: '260px',
                                        width: '100%',
                                        objectFit: 'cover',
                                        border: `1px solid ${darkMode ? 'rgba(34,197,94,0.3)' : '#86efac'}`
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Repair workflow details */}
                            <div className="border rounded p-3" style={{
                              background: darkMode ? 'rgba(255,255,255,0.03)' : '#f8fafc',
                              borderColor: darkMode ? 'rgba(148,163,184,0.2)' : '#e2e8f0'
                            }}>
                              <p className="mb-2 fw-bold d-flex align-items-center gap-2" style={{ fontSize: '0.88rem', color: darkMode ? '#cbd5e1' : '#334155' }}>
                                <span>Repair Workflow</span>
                                <HelpHint darkMode={darkMode} text="Shows contractor assignment, partner link, and recent workflow events. Click Refresh if contractor just updated." />
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary ms-auto py-0 px-2"
                                  style={{ fontSize: '0.75rem', lineHeight: '1.5' }}
                                  onClick={() => typeof handleSimulatePartnerUpdate === 'function' && handleSimulatePartnerUpdate('__refresh__', selectedReport.recordId)}
                                  title="Refresh report to see latest contractor updates"
                                >
                                  🔄 Refresh
                                </button>
                              </p>
                              <p className="mb-1 small"><strong>State:</strong> {wfState}</p>
                              <p className="mb-1 small"><strong>Contractor Email:</strong> {wf.contractorOrganizationEmail || wf.contractorEmail || 'roadhazard.contractor@gmail.com'}</p>
                              {(wf.contractorOrganizationName || wf.contractorOrganizationType) && (
                                <p className="mb-1 small">
                                  <strong>Organization:</strong> {wf.contractorOrganizationName || 'Simulation Contractor'}
                                  {wf.contractorOrganizationType ? ` (${wf.contractorOrganizationType})` : ''}
                                </p>
                              )}
                              {wf.contractorOrganizationCoverage && (
                                <p className="mb-1 small"><strong>Coverage:</strong> {wf.contractorOrganizationCoverage}</p>
                              )}
                              {wf.partnerPortalUrl && (
                                <p className="mb-2 small text-truncate"><strong>Partner Link:</strong> {wf.partnerPortalUrl}</p>
                              )}
                              <div className="small">
                                <strong>Latest Events:</strong>
                                <ul className="mb-0 mt-1 ps-3">
                                  {(wf.events || []).slice(-3).reverse().map((event) => (
                                    <li key={event.id || `${event.action}-${event.at}`}>
                                      {(event.action || 'updated').replace(/_/g, ' ')} by {event.actor || 'system'} ({formatTimeAgo(event.at)})
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              {wfState === 'Rejected' && (
                                <div className="alert alert-danger py-2 px-3 mt-2 mb-0 small">
                                  Contractor rejected this repair request.
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      {selectedReport.finalHazardClass && selectedDetections.length > 0 && (
                        <p className="mb-2">
                          <strong>Final Label:</strong>{' '}
                          <span className={`badge ${getHazardBadgeClass(selectedReport.finalHazardClass)}`}>
                            {formatHazardLabel(selectedReport.finalHazardClass)}
                          </span>
                        </p>
                      )}
                      <p className="mb-2"><strong>Description:</strong> <span className="fst-italic">"{selectedReport.description || 'No description provided'}"</span></p>

                      {!isSelectedRejected && !['Requested', 'In Progress', 'Completed'].includes(selectedStatus) ? (
                        <div className="border rounded p-3 mt-3 bg-light">
                          <p className="mb-2 fw-bold d-flex align-items-center gap-2">
                            <span>AI Result Correction</span>
                            <HelpHint darkMode={darkMode} text="Use this section only when the AI class or bounding box needs correction. VERIFY below is a separate status action." />
                          </p>
                          <div className="small text-muted mb-2">
                            If the report is already correct, just verify it below. If the AI got the class or target box wrong, fix it here and save feedback for retraining.
                          </div>
                          <div className="alert alert-warning py-2 px-3 small mb-2">
                            For shadow-heavy road photos, draw the box tightly around the visible crack only. Do not trace the full shadow region, because the saved box will be reused for retraining and repeat-image guidance.
                          </div>
                          <div className="d-flex flex-wrap gap-2 mb-2">
                            <button
                              type="button"
                              className={`btn btn-sm ${feedbackCorrect ? 'btn-success' : 'btn-outline-success'}`}
                              disabled={feedbackSaving || feedbackProgress.running}
                              onClick={() => {
                                setFeedbackCorrect(true);
                                setFeedbackTouched(true);
                              }}
                            >
                              ✅ Looks Correct
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm ${!feedbackCorrect ? 'btn-danger' : 'btn-outline-danger'}`}
                              disabled={feedbackSaving || feedbackProgress.running}
                              onClick={() => {
                                setFeedbackCorrect(false);
                                setFeedbackTouched(true);
                              }}
                            >
                              ❌ Wrong AI Result
                            </button>
                          </div>

                          {!feedbackCorrect && (
                            <>
                              {selectedDetections.length > 1 && (
                                <div className="mb-2">
                                  <label className="form-label small fw-bold mb-1">Detected hazard to correct</label>
                                  <select
                                    className="form-select form-select-sm"
                                    value={targetDetectionIndex}
                                    disabled={feedbackSaving || feedbackProgress.running}
                                    onChange={(e) => {
                                      setTargetDetectionIndex(e.target.value);
                                      setFeedbackTouched(true);
                                    }}
                                  >
                                    <option value="">Highest confidence detection</option>
                                    {selectedDetections.map((detection, idx) => (
                                      <option key={`${detection?.class || 'hazard'}-${idx}`} value={String(idx)}>
                                        {formatHazardLabel(detection?.class || 'Unknown')} ({((detection?.confidence ?? 0) * 100).toFixed(1)}%)
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div className="mb-2">
                                <label className="form-label small fw-bold mb-1">Correct hazard class</label>
                                <select
                                  className="form-select form-select-sm"
                                  value={manualHazardClass}
                                  disabled={feedbackSaving || feedbackProgress.running}
                                  onChange={(e) => {
                                    setManualHazardClass(e.target.value);
                                    setFeedbackTouched(true);
                                  }}
                                >
                                  {MANUAL_HAZARD_OPTIONS.map((hazardOption) => (
                                    <option key={hazardOption} value={hazardOption}>
                                      {formatHazardLabel(hazardOption)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </>
                          )}

                          <div className="mb-2">
                            <label className="form-label small fw-bold mb-1">Bounding box correction (optional)</label>
                            <div className="d-flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={`btn btn-sm ${bboxDrawMode ? 'btn-warning' : 'btn-outline-warning'}`}
                                disabled={!manualBboxEditable}
                                onClick={() => setBboxDrawMode((prev) => !prev)}
                              >
                                {bboxDrawMode ? 'Stop drawing' : 'Draw manual boxes'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                disabled={!(Array.isArray(manualTargetBboxes) && manualTargetBboxes.length > 0) || !manualBboxEditable}
                                onClick={removeLastManualBox}
                              >
                                Undo last box
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                disabled={!(Array.isArray(manualTargetBboxes) && manualTargetBboxes.length > 0) || !manualBboxEditable}
                                onClick={clearManualBoxes}
                              >
                                Clear all boxes
                              </button>
                            </div>
                            <div className="small text-muted mt-1">
                              {feedbackCorrect
                                ? 'Select Wrong to enable drawing and save corrected target boxes.'
                                : (Array.isArray(manualTargetBboxes) && manualTargetBboxes.length > 0
                                  ? `${manualTargetBboxes.length} manual box${manualTargetBboxes.length > 1 ? 'es' : ''} saved. They will be used for retraining when feedback is saved.`
                                  : (bboxDrawMode
                                    ? 'Drag on the image to draw a box. You can keep drawing to add more.'
                                    : 'If AI targeted the wrong area, enable draw mode and drag on the image.'))}
                            </div>
                            <div className="small text-muted mt-1">
                              {Array.isArray(manualTargetBboxes) && manualTargetBboxes.length > 0
                                ? 'Tip: use Undo last box or Clear all boxes if one is misplaced.'
                                : 'Tip: multiple boxes are useful when a photo contains several hazards.'}
                            </div>
                            <div className="small text-muted mt-1">
                              Saved boxes are used again after retraining and when the same image is uploaded later, so keeping the box tight improves future results.
                            </div>
                          </div>

                          <div className="mb-2">
                            <label className="form-label small fw-bold mb-1">Note (optional)</label>
                            <textarea
                              className="form-control form-control-sm"
                              rows="2"
                              value={feedbackNote}
                              disabled={feedbackSaving || feedbackProgress.running}
                              onChange={(e) => {
                                setFeedbackNote(e.target.value);
                                setFeedbackTouched(true);
                              }}
                              placeholder="e.g. wet patch looked like pothole"
                            />
                          </div>

                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={handleFeedbackSubmit}
                            disabled={feedbackSaving || feedbackProgress.running}
                          >
                            {feedbackSaving ? <LoadingText>Saving</LoadingText> : 'Save Feedback for Learning'}
                          </button>
                          {feedbackTouched && <span className="ms-2 small text-muted">Unsaved changes</span>}
                        </div>
                      ) : isSelectedRejected ? (
                        <div className="border rounded p-3 mt-3 bg-light text-muted">
                          <p className="mb-1 fw-bold">Rejected Report</p>
                          <p className="mb-0 small">This report is finalised as rejected. No further action is required.</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="col-md-5 d-flex flex-column gap-3 justify-content-center">
                      {selectedStatus === 'Pending' && (
                        <>
                          <div className="alert alert-info mb-0 py-2 px-3 small">
                            VERIFY marks the report as accepted. Use the correction panel on the left if the AI label or box needs fixing.
                          </div>
                          <button className="btn btn-success btn-lg w-100 py-3 fw-bold shadow-sm" disabled={feedbackProgress.running} onClick={() => handleStatusUpdate(selectedReport.recordId, 'Verified')}>✅ VERIFY REPORT</button>
                          <button className="btn btn-outline-danger btn-lg w-100 py-3 fw-bold" disabled={feedbackProgress.running} onClick={() => handleStatusUpdate(selectedReport.recordId, 'Rejected')}>❌ REJECT REPORT</button>
                        </>
                      )}
                      {selectedStatus === 'Verified' && (
                        <button className="btn btn-primary btn-lg w-100 py-3 fw-bold shadow-sm" disabled={feedbackProgress.running} onClick={() => handleSendRepairRequest(selectedReport.recordId)}>📨 SEND REPAIR REQUEST</button>
                      )}
                      {selectedStatus === 'Requested' && (
                        <>
                          <div className="alert alert-info mb-0 py-2 px-3">
                            Awaiting contractor acceptance from email portal.
                          </div>
                          <button
                            className="btn btn-outline-secondary btn-lg w-100 py-3 fw-bold"
                            disabled={feedbackProgress.running}
                            onClick={() => handleStatusUpdate(selectedReport.recordId, 'Verified')}
                          >
                            ↩ MOVE BACK TO VERIFIED
                          </button>
                        </>
                      )}
                      {selectedStatus === 'In Progress' && (
                        <div className="alert alert-success mb-0 py-2 px-3">
                          Contractor is working. Completion must be submitted from partner portal.
                        </div>
                      )}
                      <button className="btn btn-light w-100 border fw-bold text-primary" onClick={handleMapView}>📍 View on Map</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-100 bg-white border rounded d-flex align-items-center justify-content-center text-muted shadow-sm">
              <h3>Select a report from the inbox</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  </>
  );
};

export default memo(ManagementPage);
