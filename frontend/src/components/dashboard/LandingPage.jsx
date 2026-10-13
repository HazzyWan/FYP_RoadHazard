import React, { useEffect, useState } from 'react';

import HelpHint from './HelpHint';

const MetricCard = ({ icon, label, value, subtext, accentColor, tooltip, darkMode, onClick, compact = false }) => (
  <div
    className={`${compact ? 'p-3' : 'p-4'} h-100 rounded-3 position-relative`}
    style={{
      overflow: 'visible',
      zIndex: 1,
      cursor: onClick ? 'pointer' : 'default',
      background: darkMode
        ? `linear-gradient(135deg, ${accentColor}20 0%, ${accentColor}05 100%)`
        : `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}05 100%)`,
      border: `1.5px solid ${darkMode ? `${accentColor}40` : `${accentColor}30`}`,
      boxShadow: darkMode
        ? `0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 ${accentColor}20`
        : `0 2px 8px rgba(0,0,0,0.08)`,
      transition: 'all 0.3s ease'
    }}
    onClick={onClick}
    onMouseEnter={(e) => {
      e.currentTarget.style.zIndex = '10';
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = darkMode
        ? `0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 ${accentColor}20`
        : `0 6px 16px rgba(0,0,0,0.12)`;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.zIndex = '1';
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = darkMode
        ? `0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 ${accentColor}20`
        : `0 2px 8px rgba(0,0,0,0.08)`;
    }}
  >
    <div className="d-flex align-items-start justify-content-between mb-3">
      <div className="fs-5" style={{ color: accentColor, opacity: 0.9 }}>{icon}</div>
      <div className="d-flex align-items-center gap-2">
        <div
          className="rounded-2 px-2 py-1"
          style={{
            background: `${accentColor}20`,
            color: accentColor,
            fontSize: '0.75rem',
            fontWeight: '600',
            letterSpacing: '0.5px'
          }}
        >
          {label}
        </div>
        {tooltip && (
          <HelpHint text={tooltip} darkMode={darkMode} accentColor={accentColor} />
        )}
      </div>
    </div>
    <div
      className="fw-bold"
      style={{
        fontSize: compact ? '2rem' : '2.5rem',
        color: accentColor,
        lineHeight: '1.2',
        marginBottom: '0.5rem'
      }}
    >
      {value}
    </div>
    {subtext && (
      <div style={{ color: darkMode ? '#94a3b8' : '#64748b', fontSize: '0.875rem', lineHeight: '1.4' }}>
        {subtext}
      </div>
    )}
  </div>
);

const LandingPage = ({
  darkMode,
  adminDisplayName,
  stats,
  overview,
  onSelectReport,
  formatLocationText,
  formatTimeAgo,
  formatHazardLabel
}) => {
  const [showCompletionTrend, setShowCompletionTrend] = useState(false);
  const [showContractorPerformance, setShowContractorPerformance] = useState(false);
  const [showNonAiPendingList, setShowNonAiPendingList] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Hazard bar
  const HazardBar = ({ name, count, maxCount }) => {
    const percentage = Math.max((count / maxCount) * 100, 3);
    return (
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-500" style={{ color: darkMode ? '#e2e8f0' : '#1e293b', fontSize: '0.95rem' }}>
            {formatHazardLabel(name)}
          </div>
          <div
            className="fw-bold px-2 py-1 rounded-2"
            style={{
              background: darkMode ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)',
              color: '#3b82f6',
              fontSize: '0.85rem'
            }}
          >
            {count}
          </div>
        </div>
        <div
          className="rounded-full overflow-hidden"
          style={{
            height: '6px',
            background: darkMode ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)'
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${percentage}%`,
              background: `linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)`,
              transition: 'width 0.6s ease-out',
              borderRadius: '999px'
            }}
          />
        </div>
      </div>
    );
  };

  const maxHazardCount = overview.topHazards.length > 0
    ? Math.max(...overview.topHazards.map(h => h.count))
    : 1;
  const completionTrend = Array.isArray(overview.dailyCompletionTrend) ? overview.dailyCompletionTrend : [];
  const completionTrendMax = completionTrend.length > 0
    ? Math.max(...completionTrend.map((entry) => Number(entry?.count || 0)), 1)
    : 1;
  const contractorPerformance = Array.isArray(overview.contractorPerformance) ? overview.contractorPerformance : [];
  const MIN_CONTRACTOR_SAMPLE = 3;
  const contractorReliableSample = contractorPerformance.filter(
    (item) => Number(item?.totalRequests || 0) >= MIN_CONTRACTOR_SAMPLE
  );
  const contractorMostCooperative = [...contractorReliableSample]
    .sort((left, right) => {
      if (right.completionRate !== left.completionRate) return right.completionRate - left.completionRate;
      if (right.completed !== left.completed) return right.completed - left.completed;
      return right.totalRequests - left.totalRequests;
    })
    .slice(0, 1);
  const contractorLeastCooperative = contractorReliableSample
    .filter((item) => Number(item?.rejected || 0) > 0 || Number(item?.overdueCount || 0) > 0 || Number(item?.completionRate || 0) < 1)
    .sort((left, right) => {
      // Primary: cooperation score (higher = worse)
      const scoreDiff = (right.cooperationScore || 0) - (left.cooperationScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      if (left.completionRate !== right.completionRate) return left.completionRate - right.completionRate;
      if (right.rejected !== left.rejected) return right.rejected - left.rejected;
      return right.totalRequests - left.totalRequests;
    })
    .slice(0, 1);
  const contractorPreviewSample = [...contractorPerformance]
    .sort((left, right) => {
      if (right.totalRequests !== left.totalRequests) return right.totalRequests - left.totalRequests;
      if (right.completed !== left.completed) return right.completed - left.completed;
      return right.totalRequests - left.totalRequests;
    })
    .slice(0, 3);

  return (
    <div className="flex-grow-1 p-3 p-md-4" style={{ backgroundColor: darkMode ? '#141824' : '#f8fafc' }}>
      {/* Header */}
      <div className={`mb-4 d-flex ${isMobileView ? 'flex-column align-items-start gap-2' : 'align-items-end justify-content-between'}`}>
        <div>
          <h3
            className="mb-2"
            style={{
              color: darkMode ? '#f1f5f9' : '#0f172a',
              fontSize: isMobileView ? '1.55rem' : '2rem',
              fontWeight: '700',
              letterSpacing: '-0.5px'
            }}
          >
            Welcome back, {adminDisplayName}
          </h3>
          <p
            style={{
              color: darkMode ? '#94a3b8' : '#64748b',
              fontSize: '1rem',
              margin: 0,
              fontWeight: '500'
            }}
          >
            Quick operational overview • Last updated just now
          </p>
        </div>

        {Array.isArray(overview.nonAiProcessedReports) && overview.nonAiProcessedReports.length > 0 && (
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setShowNonAiPendingList(true)}
            >
              AI Pending List ({overview.nonAiProcessedReports.length})
            </button>
            <HelpHint
              darkMode={darkMode}
              accentColor="#64748b"
              text="Opens reports that have not produced any AI result yet (no detection and no feedback record)."
            />
          </div>
        )}
      </div>

      {/* Top Metrics Row */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-6 col-lg-3">
          <MetricCard
            icon="📊"
            label="FIXED TODAY"
            value={overview.completedToday}
            subtext="Click for daily completion trend"
            accentColor="#10b981"
            tooltip="Counts hazards marked completed today based on completion/fix timestamps."
            darkMode={darkMode}
            onClick={() => setShowCompletionTrend(true)}
            compact={isMobileView}
          />
        </div>
        <div className="col-12 col-sm-6 col-lg-3">
          <MetricCard
            icon="⚠️"
            label="NEEDS ATTENTION"
            value={overview.unresolvedCount}
            subtext="Pending, verified, requested, in progress"
            accentColor="#ef4444"
            tooltip="Counts reports that still need work: pending review, verified but not finished, requested, or currently in progress."
            darkMode={darkMode}
            compact={isMobileView}
          />
        </div>
        <div className="col-12 col-sm-6 col-lg-3">
          <MetricCard
            icon="✓"
            label="MODEL CORRECTIONS"
            value={`${(overview.correctionRate * 100).toFixed(1)}%`}
            subtext={`${overview.correctedCount}/${overview.aiReviewedCount} reviewed`}
            accentColor="#f59e0b"
            tooltip="Shows how often admins had to fix the AI result after review. A higher value means the model is making more mistakes."
            darkMode={darkMode}
            compact={isMobileView}
          />
        </div>
        <div className="col-12 col-sm-6 col-lg-3">
          <MetricCard
            icon="🔍"
            label="MISSED DETECTIONS"
            value={overview.falseNegativeCount}
            subtext="False negative signals"
            accentColor="#8b5cf6"
            tooltip="Reports where hazards were missed by AI first, then corrected by admin review."
            darkMode={darkMode}
            compact={isMobileView}
          />
        </div>
      </div>

      {showCompletionTrend && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100"
          style={{ zIndex: 12000, background: 'rgba(2,6,23,0.55)' }}
          onClick={() => setShowCompletionTrend(false)}
        >
          <div className="d-flex align-items-center justify-content-center h-100 p-3">
            <div
              className={`rounded-3 ${isMobileView ? 'p-3' : 'p-4'}`}
              style={{
                width: 'min(760px, 96vw)',
                maxHeight: '88vh',
                overflowY: 'auto',
                background: darkMode ? '#0f172a' : '#ffffff',
                border: `1px solid ${darkMode ? 'rgba(148,163,184,0.28)' : '#e2e8f0'}`,
                boxShadow: '0 22px 64px rgba(2,6,23,0.35)'
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`d-flex ${isMobileView ? 'flex-column align-items-start gap-2' : 'align-items-center justify-content-between'} mb-3`}>
                <div>
                  <h5 className="mb-1" style={{ color: darkMode ? '#f8fafc' : '#0f172a' }}>
                    Daily Completion Trend
                  </h5>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                    Last 14 days of completed/fixed hazards
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setShowCompletionTrend(false)}
                >
                  Close
                </button>
              </div>

              {completionTrend.length === 0 ? (
                <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                  No completion data available yet.
                </div>
              ) : (
                isMobileView ? (
                  <div className="d-flex flex-column gap-2">
                    {completionTrend.map((entry) => {
                      const count = Number(entry?.count || 0);
                      const widthPct = Math.max(8, (count / completionTrendMax) * 100);
                      return (
                        <div key={`mobile-${entry.dayStart}`}>
                          <div className="d-flex justify-content-between small mb-1" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>
                            <span>{entry.dayLabel}</span>
                            <strong>{count}</strong>
                          </div>
                          <div style={{ height: '8px', background: darkMode ? 'rgba(148,163,184,0.2)' : '#e2e8f0', borderRadius: '999px' }}>
                            <div
                              style={{
                                width: `${widthPct}%`,
                                height: '100%',
                                borderRadius: '999px',
                                background: darkMode
                                  ? 'linear-gradient(90deg, #34d399 0%, #0ea5e9 100%)'
                                  : 'linear-gradient(90deg, #16a34a 0%, #0284c7 100%)'
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="d-flex gap-2 align-items-end" style={{ minHeight: '220px' }}>
                    {completionTrend.map((entry) => {
                      const count = Number(entry?.count || 0);
                      const heightPct = Math.max(6, (count / completionTrendMax) * 100);
                      return (
                        <div key={String(entry?.dayStart)} className="d-flex flex-column align-items-center flex-grow-1">
                          <div className="small mb-1 fw-semibold" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>
                            {count}
                          </div>
                          <div
                            className="w-100 rounded-2"
                            style={{
                              height: `${heightPct}%`,
                              minHeight: '8px',
                              background: darkMode
                                ? 'linear-gradient(180deg, #34d399 0%, #0ea5e9 100%)'
                                : 'linear-gradient(180deg, #16a34a 0%, #0284c7 100%)',
                              transition: 'height 0.25s ease'
                            }}
                            title={`${entry.dayLabel}: ${count} completed`}
                          />
                          <div className="small mt-2 text-center" style={{ color: darkMode ? '#94a3b8' : '#64748b', fontSize: '0.72rem' }}>
                            {entry.dayLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {showNonAiPendingList && Array.isArray(overview.nonAiProcessedReports) && overview.nonAiProcessedReports.length > 0 && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100"
          style={{ zIndex: 12000, background: 'rgba(2,6,23,0.55)' }}
          onClick={() => setShowNonAiPendingList(false)}
        >
          <div className="d-flex align-items-center justify-content-center h-100 p-3">
            <div
              className={`rounded-3 ${isMobileView ? 'p-3' : 'p-4'}`}
              style={{
                width: 'min(980px, 96vw)',
                maxHeight: '88vh',
                overflowY: 'auto',
                background: darkMode ? '#0f172a' : '#ffffff',
                border: `1px solid ${darkMode ? 'rgba(148,163,184,0.28)' : '#e2e8f0'}`,
                boxShadow: '0 22px 64px rgba(2,6,23,0.35)'
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`d-flex ${isMobileView ? 'flex-column align-items-start gap-2' : 'align-items-center justify-content-between'} mb-3`}>
                <div>
                  <h5 className="mb-1" style={{ color: darkMode ? '#f8fafc' : '#0f172a' }}>
                    AI Processing Pending Reports
                  </h5>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                    {overview.nonAiProcessedReports.length} report(s) waiting for AI output.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setShowNonAiPendingList(false)}
                >
                  Close
                </button>
              </div>

              <div className="row g-2">
                {overview.nonAiProcessedReports.map((report) => (
                  <div className="col-12 col-md-6 col-xl-4" key={String(report.recordId || report.fileName)}>
                    <button
                      type="button"
                      className="w-100 text-start p-2 rounded-2"
                      onClick={() => {
                        if (report?.recordId) {
                          onSelectReport(report.recordId);
                          setShowNonAiPendingList(false);
                        }
                      }}
                      style={{
                        border: `1px solid ${darkMode ? 'rgba(148,163,184,0.22)' : '#e2e8f0'}`,
                        background: darkMode ? 'rgba(30,41,59,0.55)' : '#f8fafc',
                        color: darkMode ? '#e2e8f0' : '#1e293b'
                      }}
                    >
                      <div className="fw-semibold">#{String(report.recordId || '').slice(0, 8) || 'Unknown ID'}</div>
                      <div className="small text-truncate" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                        {report.fileName}
                      </div>
                      <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                        {report.status || 'Unknown'} • {formatTimeAgo(report.timestamp)}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="row g-3 mb-4">
        {/* Top Hazard Types */}
        <div className="col-12 col-lg-5">
          <div
            className="p-4 rounded-3 h-100"
            style={{
              background: darkMode
                ? `linear-gradient(135deg, #1e40af15 0%, #7c3aed05 100%)`
                : `linear-gradient(135deg, #dbeafe15 0%, #ede9fe05 100%)`,
              border: `1.5px solid ${darkMode ? 'rgba(79,172,254,0.2)' : 'rgba(191,219,254,0.4)'}`,
              boxShadow: darkMode ? '0 4px 16px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            <div className="mb-3">
              <h5
                className="mb-1"
                style={{
                  color: darkMode ? '#f1f5f9' : '#0f172a',
                  fontWeight: '700',
                  fontSize: '1.1rem'
                }}
              >
                Top Hazard Types
              </h5>
              <p
                style={{
                  color: darkMode ? '#94a3b8' : '#64748b',
                  fontSize: '0.875rem',
                  margin: 0
                }}
              >
                Most detected in this dataset
              </p>
            </div>
            {overview.topHazards.length > 0 ? (
              <div>
                {overview.topHazards.map((hazard, idx) => (
                  <HazardBar
                    key={idx}
                    name={hazard.name}
                    count={hazard.count}
                    maxCount={maxHazardCount}
                  />
                ))}
              </div>
            ) : (
              <div style={{ color: darkMode ? '#94a3b8' : '#64748b', textAlign: 'center', padding: '2rem 0' }}>
                No hazards detected yet
              </div>
            )}
          </div>
        </div>

        {/* Retrain Status + Contractor Ops */}
        <div className="col-12 col-lg-7">
          <div className="row g-3 h-100">
            {/* Retrain Status */}
            <div className="col-12 col-xl-6">
              <div
                className="p-4 rounded-3 h-100"
                style={{
                  background: darkMode
                    ? `linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(16, 185, 129, 0.14) 100%)`
                    : `linear-gradient(135deg, #ccfbf105 0%, #d1fae505 100%)`,
                  border: `1.5px solid ${darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(167,243,208,0.4)'}`,
                  boxShadow: darkMode ? '0 4px 16px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.06)'
                }}
              >
                <h6
                  className="mb-3 d-flex align-items-center gap-2"
                  style={{
                    color: darkMode ? '#f1f5f9' : '#0f172a',
                    fontWeight: '700',
                    fontSize: '1rem'
                  }}
                >
                  🔄 Model Retraining
                  <HelpHint darkMode={darkMode} text="Automatic model retraining when enough corrected samples accumulate" accentColor="#10b981" />
                </h6>
                <div className="small mb-3">
                  <div className="d-flex justify-content-between mb-2">
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Status</span>
                    <span
                      className="fw-bold px-2 py-1 rounded-2"
                      style={{
                        background: overview.retrainRunning ? '#ef4444' : '#10b981',
                        color: '#fff',
                        fontSize: '0.75rem'
                      }}
                    >
                      {overview.retrainRunning ? '⏳ Running' : overview.retrainEnabled ? '✓ Ready' : '⊘ Disabled'}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Pending samples</span>
                    <strong style={{ color: darkMode ? '#e2e8f0' : '#1e293b' }}>
                      {overview.pendingFeedbackCount} / {overview.feedbackThreshold}
                    </strong>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Last triggered</span>
                    <strong style={{ color: darkMode ? '#e2e8f0' : '#1e293b' }}>{overview.lastRetrainLabel}</strong>
                  </div>
                  <div className="d-flex justify-content-between">
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Last completed</span>
                    <strong style={{ color: darkMode ? '#e2e8f0' : '#1e293b' }}>{overview.lastCompletedLabel}</strong>
                  </div>
                </div>
                {overview.cooldownMinutes > 0 && (
                  <div
                    className="mt-3 small p-2 rounded-2"
                    style={{
                      background: darkMode ? 'rgba(245,158,11,0.1)' : 'rgba(251,146,60,0.1)',
                      color: darkMode ? '#fbbf24' : '#ea580c',
                      borderLeft: `3px solid ${darkMode ? '#fbbf24' : '#f97316'}`
                    }}
                  >
                    ℹ️ Cooldown: ~{overview.cooldownMinutes}m remaining
                  </div>
                )}
              </div>
            </div>

            {/* Contractor Ops */}
            <div className="col-12 col-xl-6">
              <div
                className="p-4 rounded-3 h-100"
                style={{
                  background: darkMode
                    ? `linear-gradient(135deg, #7c2d1215 0%, #991b1b05 100%)`
                    : `linear-gradient(135deg, #fee2e215 0%, #fecaca05 100%)`,
                  border: `1.5px solid ${darkMode ? 'rgba(244,63,94,0.2)' : 'rgba(254,202,202,0.4)'}`,
                  boxShadow: darkMode ? '0 4px 16px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.06)'
                }}
              >
                <h6
                  className="mb-3 d-flex align-items-center gap-2"
                  style={{
                    color: darkMode ? '#f1f5f9' : '#0f172a',
                    fontWeight: '700',
                    fontSize: '1rem'
                  }}
                >
                  👷 Repair Requests
                  <HelpHint darkMode={darkMode} text="Track repair work status and contractor assignments" accentColor="#ef4444" />
                </h6>
                <div className="mb-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setShowContractorPerformance(true)}
                  >
                    Contractor Performance
                  </button>
                </div>
                <div className="small">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Unassigned</span>
                    <strong
                      style={{
                        color: overview.unassignedCount > 0 ? '#ef4444' : '#10b981',
                        fontSize: '1.1rem'
                      }}
                    >
                      {overview.unassignedCount}
                    </strong>
                  </div>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="d-flex align-items-center gap-1">
                      <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Overdue</span>
                      <HelpHint darkMode={darkMode} text="Requests become overdue when there is no completion update for more than 3 days." accentColor="#f59e0b" />
                    </div>
                    <strong
                      style={{
                        color: overview.overdueRequestedCount > 0 ? '#f59e0b' : '#10b981',
                        fontSize: '1.1rem'
                      }}
                    >
                      {overview.overdueRequestedCount}
                    </strong>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Rejections</span>
                    <strong
                      style={{
                        color: overview.partnerRejectedCount > 0 ? '#8b5cf6' : '#10b981',
                        fontSize: '1.1rem'
                      }}
                    >
                      {overview.partnerRejectedCount}
                    </strong>
                  </div>
                  <div className="d-flex justify-content-between pt-2" style={{ borderTop: `1px solid ${darkMode ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)'}` }}>
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>Notifications</span>
                    <strong style={{ color: '#3b82f6', fontSize: '1.1rem' }}>
                      {overview.unreadRepairNotificationCount}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showContractorPerformance && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100"
          style={{ zIndex: 12000, background: 'rgba(2,6,23,0.55)' }}
          onClick={() => setShowContractorPerformance(false)}
        >
          <div className="d-flex align-items-center justify-content-center h-100 p-3">
            <div
              className={`rounded-3 ${isMobileView ? 'p-3' : 'p-4'}`}
              style={{
                width: 'min(860px, 96vw)',
                maxHeight: '88vh',
                overflowY: 'auto',
                background: darkMode ? '#0f172a' : '#ffffff',
                border: `1px solid ${darkMode ? 'rgba(148,163,184,0.28)' : '#e2e8f0'}`,
                boxShadow: '0 22px 64px rgba(2,6,23,0.35)'
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`d-flex ${isMobileView ? 'flex-column align-items-start gap-2' : 'align-items-center justify-content-between'} mb-3`}>
                <div>
                  <h5 className="mb-1" style={{ color: darkMode ? '#f8fafc' : '#0f172a' }}>
                    Contractor Cooperation Overview
                  </h5>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                    Ranking based on completion rate among resolved requests (completed vs rejected). Minimum sample: {MIN_CONTRACTOR_SAMPLE} requests.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setShowContractorPerformance(false)}
                >
                  Close
                </button>
              </div>

              {contractorPerformance.length === 0 ? (
                <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                  No contractor performance data yet.
                </div>
              ) : contractorReliableSample.length === 0 ? (
                <div>
                  <div className="small mb-3" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                    Not enough data yet for reliable ranking. Assign more reports to contractors to build fair comparisons.
                  </div>
                  <div className="p-3 rounded-3" style={{
                    background: darkMode ? 'rgba(59,130,246,0.10)' : '#eff6ff',
                    border: `1px solid ${darkMode ? 'rgba(96,165,250,0.25)' : '#bfdbfe'}`
                  }}>
                    <div className="fw-semibold mb-2" style={{ color: darkMode ? '#bfdbfe' : '#1d4ed8' }}>
                      Early Preview (low confidence)
                    </div>
                    {contractorPreviewSample.map((item) => (
                      <div key={`preview-${item.key}`} className="small d-flex justify-content-between py-1" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>
                        <span>{item.name}</span>
                        <span>{item.completed} completed • {item.rejected} rejected • {item.totalRequests} total</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="row g-3">
                  <div className="col-12 col-lg-6">
                    <div className="p-3 rounded-3" style={{
                      background: darkMode ? 'rgba(16,185,129,0.10)' : '#f0fdf4',
                      border: `1px solid ${darkMode ? 'rgba(16,185,129,0.25)' : '#bbf7d0'}`
                    }}>
                      <h6 className="mb-2" style={{ color: darkMode ? '#bbf7d0' : '#166534' }}>Most Cooperative</h6>
                      {contractorMostCooperative.map((item) => (
                        <div key={`best-${item.key}`} className="d-flex justify-content-between align-items-center py-2" style={{ borderBottom: `1px solid ${darkMode ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)'}` }}>
                          <div>
                            <div className="fw-semibold" style={{ color: darkMode ? '#f8fafc' : '#0f172a' }}>{item.name}</div>
                            <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                              {item.completed} completed • {item.rejected} rejected
                            </div>
                          </div>
                          <div className="fw-bold" style={{ color: darkMode ? '#34d399' : '#15803d' }}>
                            {(Number(item.completionRate || 0) * 100).toFixed(0)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="col-12 col-lg-6">
                    <div className="p-3 rounded-3" style={{
                      background: darkMode ? 'rgba(239,68,68,0.10)' : '#fef2f2',
                      border: `1px solid ${darkMode ? 'rgba(239,68,68,0.25)' : '#fecaca'}`
                    }}>
                      <h6 className="mb-2" style={{ color: darkMode ? '#fecaca' : '#991b1b' }}>Least Cooperative</h6>
                      {contractorLeastCooperative.length === 0 ? (
                        <div className="small" style={{ color: darkMode ? '#cbd5e1' : '#475569' }}>
                          No clear underperformer yet. Current contractors are completing assigned work without rejected outcomes.
                        </div>
                      ) : contractorLeastCooperative.map((item) => (
                        <div key={`least-${item.key}`} className="d-flex justify-content-between align-items-center py-2" style={{ borderBottom: `1px solid ${darkMode ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)'}` }}>
                          <div>
                            <div className="fw-semibold" style={{ color: darkMode ? '#f8fafc' : '#0f172a' }}>{item.name}</div>
                            <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                              {item.completed} completed • {item.rejected} rejected
                              {Number(item.overdueCount || 0) > 0 && (
                                <span style={{ color: darkMode ? '#fbbf24' : '#b45309' }}> • {item.overdueCount} overdue</span>
                              )}
                            </div>
                          </div>
                          <div className="text-end">
                            <div className="fw-bold" style={{ color: darkMode ? '#f87171' : '#b91c1c', fontSize: '0.95rem' }}>
                              Score: {(item.cooperationScore || 0).toFixed(0)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* High Priority Queue */}
      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div
            className="p-4 rounded-3"
            style={{
              background: darkMode
                ? `linear-gradient(135deg, #1e293b 0%, #0f172a 100%)`
                : `linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)`,
              border: `1.5px solid ${darkMode ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.08)'}`,
              boxShadow: darkMode ? '0 4px 16px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            <h5
              className="mb-3"
              style={{
                color: darkMode ? '#f1f5f9' : '#0f172a',
                fontWeight: '700',
                fontSize: '1.1rem'
              }}
            >
              🎯 High Priority Queue
            </h5>
            {overview.highPriorityQueue.length === 0 ? (
              <div style={{ color: darkMode ? '#94a3b8' : '#64748b', textAlign: 'center', padding: '2rem 0' }}>
                All caught up! No high-priority reports.
              </div>
            ) : (
              isMobileView ? (
                <div className="d-flex flex-column gap-2">
                  {overview.highPriorityQueue.map((report) => {
                    const topDetection = (report.detections || []).reduce((best, detection) => {
                      const bestConf = Number(best?.confidence || 0);
                      const currentConf = Number(detection?.confidence || 0);
                      return currentConf > bestConf ? detection : best;
                    }, report.detections?.[0] || null);
                    const confidence = Number(topDetection?.confidence || report._maxConfidence || 0) * 100;
                    return (
                      <button
                        key={`mobile-priority-${report.recordId}`}
                        type="button"
                        className="w-100 text-start p-3 rounded-3"
                        onClick={() => onSelectReport(report.recordId)}
                        style={{
                          border: `1px solid ${darkMode ? 'rgba(148,163,184,0.2)' : '#e2e8f0'}`,
                          background: darkMode ? 'rgba(30,41,59,0.6)' : '#ffffff',
                          color: darkMode ? '#e2e8f0' : '#0f172a'
                        }}
                      >
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <strong style={{ color: '#3b82f6' }}>#{String(report.recordId).slice(0, 8)}</strong>
                          <span className="small">{formatTimeAgo(report.timestamp)}</span>
                        </div>
                        <div className="small mb-1" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>
                          {report.status} • {formatHazardLabel(topDetection?.class || report.finalHazardClass || 'unknown')}
                        </div>
                        <div className="small text-truncate" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                          {formatLocationText(report)}
                        </div>
                        <div className="small mt-1 fw-semibold" style={{ color: confidence > 90 ? '#10b981' : confidence > 70 ? '#f59e0b' : '#ef4444' }}>
                          Confidence {confidence.toFixed(1)}%
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="table-responsive">
                  <table
                    className="table table-hover align-middle mb-0"
                    style={{
                      color: darkMode ? '#e2e8f0' : '#0f172a',
                      fontSize: '0.9rem'
                    }}
                  >
                    <thead>
                      <tr style={{ borderColor: darkMode ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)' }}>
                        <th style={{ color: darkMode ? '#94a3b8' : '#64748b', fontWeight: '600', fontSize: '0.8rem' }}>ID</th>
                        <th style={{ color: darkMode ? '#94a3b8' : '#64748b', fontWeight: '600', fontSize: '0.8rem' }}>Status</th>
                        <th style={{ color: darkMode ? '#94a3b8' : '#64748b', fontWeight: '600', fontSize: '0.8rem' }}>Hazard</th>
                        <th style={{ color: darkMode ? '#94a3b8' : '#64748b', fontWeight: '600', fontSize: '0.8rem' }}>Confidence</th>
                        <th style={{ color: darkMode ? '#94a3b8' : '#64748b', fontWeight: '600', fontSize: '0.8rem' }}>Location</th>
                        <th style={{ color: darkMode ? '#94a3b8' : '#64748b', fontWeight: '600', fontSize: '0.8rem' }}>Age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.highPriorityQueue.map((report) => {
                        const topDetection = (report.detections || []).reduce((best, detection) => {
                          const bestConf = Number(best?.confidence || 0);
                          const currentConf = Number(detection?.confidence || 0);
                          return currentConf > bestConf ? detection : best;
                        }, report.detections?.[0] || null);
                        const confidence = Number(topDetection?.confidence || report._maxConfidence || 0) * 100;

                        return (
                          <tr
                            key={report.recordId}
                            onClick={() => onSelectReport(report.recordId)}
                            style={{
                              cursor: 'pointer',
                              borderColor: darkMode ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = darkMode ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <td className="fw-bold" style={{ color: '#3b82f6' }}>#{String(report.recordId).slice(0, 8)}</td>
                            <td>
                              <span
                                className="px-2 py-1 rounded-2"
                                style={{
                                  background: report.status === 'Pending' ? (darkMode ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)') : (darkMode ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.1)'),
                                  color: report.status === 'Pending' ? '#3b82f6' : '#10b981',
                                  fontSize: '0.75rem',
                                  fontWeight: '600'
                                }}
                              >
                                {report.status}
                              </span>
                            </td>
                            <td className="fw-500">{formatHazardLabel(topDetection?.class || report.finalHazardClass || 'unknown')}</td>
                            <td>
                              <span
                                className="fw-bold"
                                style={{
                                  color: confidence > 90 ? '#10b981' : confidence > 70 ? '#f59e0b' : '#ef4444'
                                }}
                              >
                                {confidence.toFixed(1)}%
                              </span>
                            </td>
                            <td className="text-nowrap text-truncate">{formatLocationText(report)}</td>
                            <td>{formatTimeAgo(report.timestamp)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>

        {/* Pipeline Snapshot */}
        <div className="col-12 col-lg-4">
          <div
            className="p-4 rounded-3 h-100"
            style={{
              background: darkMode
                ? `linear-gradient(135deg, #1e293b 0%, #0f172a 100%)`
                : `linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)`,
              border: `1.5px solid ${darkMode ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.08)'}`,
              boxShadow: darkMode ? '0 4px 16px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            <h5
              className="mb-3"
              style={{
                color: darkMode ? '#f1f5f9' : '#0f172a',
                fontWeight: '700',
                fontSize: '1.1rem'
              }}
            >
              📊 Pipeline Status
            </h5>
            <div className="small space-y-2">
              {[
                { label: 'Total', value: stats.all, color: '#3b82f6' },
                { label: 'Pending', value: stats.pending, color: '#ef4444' },
                { label: 'Verified', value: stats.verified, color: '#f59e0b' },
                { label: 'Requested', value: stats.requested, color: '#8b5cf6' },
                { label: 'In Progress', value: stats.inProgress, color: '#06b6d4' },
                { label: 'Completed', value: stats.completed, color: '#10b981' },
                { label: 'Rejected', value: stats.rejected, color: '#6b7280' }
              ].map((item, idx) => (
                <div key={idx} className="d-flex justify-content-between align-items-center mb-2 pb-2" style={{ borderBottom: `1px solid ${darkMode ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)'}` }}>
                  <div className="d-flex align-items-center gap-2">
                    <div
                      className="rounded-full"
                      style={{
                        width: '8px',
                        height: '8px',
                        background: item.color
                      }}
                    />
                    <span style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>{item.label}</span>
                  </div>
                  <strong style={{ color: darkMode ? '#e2e8f0' : '#0f172a', fontSize: '1rem' }}>
                    {item.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
