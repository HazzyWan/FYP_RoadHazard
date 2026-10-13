import React, { memo, useEffect, useMemo, useState } from 'react';

import HelpHint from './HelpHint';
import LoadingText from '../common/LoadingText';
import { CONTRACTOR_DIRECTORY } from './contractorDirectory';

const inferOrganizationProfile = (contractor = {}, contractorDirectory = []) => {
  const fromWorkflowName = String(contractor?.contractorOrganizationName || '').trim();
  const fromWorkflowType = String(contractor?.contractorOrganizationType || '').trim();
  const fromWorkflowCoverage = String(contractor?.contractorOrganizationCoverage || '').trim();
  const fromWorkflowEmail = String(contractor?.contractorOrganizationEmail || '').trim();
  const fromWorkflowPhone = String(contractor?.contractorOrganizationPhone || '').trim();
  const fromWorkflowContactPerson = String(contractor?.contractorOrganizationContactPerson || '').trim();
  if (fromWorkflowName || fromWorkflowType || fromWorkflowCoverage) {
    return {
      name: fromWorkflowName || 'Simulation Contractor (Malaysia)',
      type: fromWorkflowType || 'Assigned contractor organization',
      coverage: fromWorkflowCoverage || 'Selected by admin',
      email: fromWorkflowEmail || '',
      phone: fromWorkflowPhone || '',
      contactPerson: fromWorkflowContactPerson || '',
      assumed: false
    };
  }

  const normalizedEmail = String(contractor?.contractorEmail || '').trim().toLowerCase();
  const match = contractorDirectory.find((org) => (
    (org.domainHints || []).some((hint) => normalizedEmail.includes(String(hint).toLowerCase()))
  ));

  if (match) {
    return {
      name: match.name,
      type: match.type,
      coverage: match.coverage,
      email: match.email,
      phone: match.phone,
      contactPerson: match.contactPerson,
      assumed: false
    };
  }

  return {
    name: 'Assumed Local Roadworks Contractor (Malaysia)',
    type: 'Local authority-appointed contractor',
    coverage: 'Project district / municipal zone',
    email: 'contact@local-roadworks.sim.local',
    phone: '+60 3-0000 0000',
    contactPerson: 'Operations Desk',
    assumed: true
  };
};

const EMPTY_FORM = {
  name: '',
  type: '',
  coverage: '',
  email: '',
  phone: '',
  contactPerson: '',
  domainHints: ''
};

const ContractorsPage = ({ API_URL, onOpenReport, onDirectoryChanged, darkMode = false }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contractors, setContractors] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [contractorDirectory, setContractorDirectory] = useState([]);
  const [newContractor, setNewContractor] = useState(EMPTY_FORM);
  const [savingContractor, setSavingContractor] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedAssignmentKeys, setExpandedAssignmentKeys] = useState(new Set());
  const [hoveredAssignmentKey, setHoveredAssignmentKey] = useState('');
  const [hoveredDirectoryId, setHoveredDirectoryId] = useState('');

  const toggleOrgExpanded = (assignmentKey) => {
    const updated = new Set(expandedAssignmentKeys);
    if (updated.has(assignmentKey)) {
      updated.delete(assignmentKey);
    } else {
      updated.add(assignmentKey);
    }
    setExpandedAssignmentKeys(updated);
  };

  const fetchAssignments = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/contractors`, {
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load contractors.');
      }
      const incoming = Array.isArray(payload.contractors) ? payload.contractors : [];
      setContractors(incoming);
    } catch (fetchError) {
      setError(fetchError?.message || 'Failed to load contractors.');
      setContractors([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDirectory = async () => {
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const response = await fetch(`${API_URL}/contractor-directory`, {
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load contractor directory.');
      }
      const incoming = Array.isArray(payload.contractors) ? payload.contractors : [];
      setContractorDirectory(incoming.length ? incoming : CONTRACTOR_DIRECTORY);
    } catch {
      setDirectoryError('Using fallback contractor list while directory API is unavailable.');
      setContractorDirectory(CONTRACTOR_DIRECTORY);
    } finally {
      setDirectoryLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
    fetchDirectory();
  }, [API_URL]);

  const refreshDirectory = async () => {
    await fetchDirectory();
    if (typeof onDirectoryChanged === 'function') {
      await onDirectoryChanged();
    }
  };

  const handleAddContractor = async (event) => {
    event.preventDefault();
    if (!newContractor.name.trim()) return;

    setSavingContractor(true);
    try {
      const payload = {
        name: newContractor.name,
        type: newContractor.type,
        coverage: newContractor.coverage,
        email: newContractor.email,
        phone: newContractor.phone,
        contactPerson: newContractor.contactPerson,
        domainHints: newContractor.domainHints
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      };
      const response = await fetch(`${API_URL}/contractor-directory`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to add contractor.');
      }
      setNewContractor(EMPTY_FORM);
      setShowAddForm(false);
      await refreshDirectory();
    } catch (saveError) {
      setDirectoryError(saveError?.message || 'Failed to add contractor.');
    } finally {
      setSavingContractor(false);
    }
  };

  const handleDeleteContractor = async (contractor) => {
    const contractorId = String(contractor?.id || '').trim();
    if (!contractorId) return;
    if (!window.confirm(`Remove ${contractor?.name || contractorId} from contractor directory?`)) return;

    setDeletingId(contractorId);
    try {
      const response = await fetch(`${API_URL}/contractor-directory/${encodeURIComponent(contractorId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to remove contractor.');
      }
      await refreshDirectory();
    } catch (deleteError) {
      setDirectoryError(deleteError?.message || 'Failed to remove contractor.');
    } finally {
      setDeletingId('');
    }
  };

  const totals = useMemo(() => ({
    contractors: contractors.length,
    requests: contractors.reduce((sum, item) => sum + Number(item?.totalRequests || 0), 0),
    active: contractors.reduce((sum, item) => sum + Number(item?.activeRequests || 0), 0),
    completed: contractors.reduce((sum, item) => sum + Number(item?.completed || 0), 0),
    rejected: contractors.reduce((sum, item) => sum + Number(item?.rejected || 0), 0)
  }), [contractors]);

  // --- Least Cooperative Contractors scoring ---
  const cooperativenessRanking = useMemo(() => {
    if (!Array.isArray(contractors) || contractors.length === 0) return [];
    const now = Date.now();
    const OVERDUE_DAYS = 7;

    return contractors
      .map((item) => {
        const total = Number(item?.totalRequests || 0);
        if (total === 0) return null;

        const rejected = Number(item?.rejected || 0);
        const completed = Number(item?.completed || 0);
        const requests = Array.isArray(item?.requests) ? item.requests : [];

        // Rejection rate (0–1)
        const rejectionRate = rejected / total;

        // Overdue: Requested or In Progress for more than OVERDUE_DAYS days
        let overdueCount = 0;
        let totalCompletionDays = 0;
        let completionSamples = 0;

        requests.forEach((req) => {
          const status = String(req?.status || '').toLowerCase();
          const requestedAt = req?.requestedAt ? Date.parse(req.requestedAt) : null;
          const completedAt = req?.completedAt ? Date.parse(req.completedAt) : null;

          if (requestedAt && (status === 'requested' || status === 'in progress')) {
            const daysOpen = (now - requestedAt) / (1000 * 60 * 60 * 24);
            if (daysOpen > OVERDUE_DAYS) overdueCount += 1;
          }

          if (requestedAt && completedAt && completedAt > requestedAt) {
            totalCompletionDays += (completedAt - requestedAt) / (1000 * 60 * 60 * 24);
            completionSamples += 1;
          }
        });

        const overdueRate = (item?.activeRequests || 0) > 0 ? overdueCount / (item.activeRequests) : 0;
        const avgCompletionDays = completionSamples > 0 ? totalCompletionDays / completionSamples : null;

        // Score: higher = less cooperative (0–100 scale)
        // Rejection rate:    40 pts max
        // Overdue rate:      40 pts max
        // Slow completion:   20 pts max (benchmark: 14 days = full 20 pts)
        const completionScore = avgCompletionDays !== null
          ? Math.min(20, (avgCompletionDays / 14) * 20)
          : 0;
        const score = (rejectionRate * 40) + (overdueRate * 40) + completionScore;

        // Determine badge
        let badge, badgeColor, badgeBg;
        if (score >= 50) { badge = 'Poor'; badgeColor = '#b91c1c'; badgeBg = '#fef2f2'; }
        else if (score >= 20) { badge = 'Fair'; badgeColor = '#b45309'; badgeBg = '#fffbeb'; }
        else { badge = 'Good'; badgeColor = '#15803d'; badgeBg = '#f0fdf4'; }

        const profile = inferOrganizationProfile(item, contractorDirectory);

        return {
          name: profile.name,
          total,
          rejected,
          completed,
          overdueCount,
          avgCompletionDays,
          rejectionRate,
          overdueRate,
          score,
          badge,
          badgeColor,
          badgeBg
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }, [contractors, contractorDirectory]);

  const summaryStats = useMemo(() => ([
    { key: 'contractors', label: 'contractors', value: totals.contractors, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    { key: 'requests', label: 'requests', value: totals.requests, color: '#475569', bg: '#f8fafc', border: '#e2e8f0' },
    { key: 'active', label: 'active', value: totals.active, color: '#0891b2', bg: '#ecfeff', border: '#bae6fd' },
    { key: 'completed', label: 'completed', value: totals.completed, color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    { key: 'rejected', label: 'rejected', value: totals.rejected, color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' }
  ]), [totals]);

  const directoryById = useMemo(() => {
    const map = new Map();
    contractorDirectory.forEach((item) => map.set(item.id, item));
    return map;
  }, [contractorDirectory]);

  const assignmentList = useMemo(() => {
    if (!Array.isArray(contractors) || contractors.length === 0) return [];
    return contractors.map((item, index) => {
      const orgId = String(item?.contractorOrganizationId || '').trim();
      const org = orgId ? directoryById.get(orgId) : null;
      const profile = inferOrganizationProfile(item, contractorDirectory);
      const assignmentKey = String(item?.contractorKey || '').trim() || [
        orgId || String(item?.contractorOrganizationName || '').trim() || profile.name,
        String(item?.contractorEmail || '').trim().toLowerCase(),
        String(item?.contractorOrganizationEmail || '').trim().toLowerCase(),
        String(index)
      ].join('::');
      return {
        assignmentKey,
        contractorEmail: item?.contractorEmail || '',
        organization: profile.name,
        contactPerson: profile.contactPerson || org?.contactPerson || 'Operations Desk',
        contactEmail: profile.email || org?.email || 'contact@local-roadworks.sim.local',
        phone: profile.phone || org?.phone || '+60 3-0000 0000',
        coverage: profile.coverage || org?.coverage || 'Project district / municipal zone',
        requests: Array.isArray(item?.requests) ? item.requests : [],
        active: Number(item?.activeRequests || 0),
        completed: Number(item?.completed || 0),
        rejected: Number(item?.rejected || 0)
      };
    });
  }, [contractors, directoryById, contractorDirectory]);

  const statusBadgeClass = (value) => {
    const status = String(value || '').toLowerCase();
    if (status.includes('in progress')) return 'bg-info text-dark';
    if (status.includes('requested')) return 'bg-primary';
    if (status.includes('completed')) return 'bg-success';
    if (status.includes('rejected')) return 'bg-danger';
    return 'bg-secondary';
  };

  const openReportFromRequest = (request) => {
    if (typeof onOpenReport !== 'function') return;
    const recordId = String(request?.recordId || '').trim();
    if (!recordId) return;
    onOpenReport(recordId);
  };

  return (
    <div className="container-fluid py-4">
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body d-flex flex-wrap gap-3 justify-content-between align-items-center">
          <div>
            <h4 className="mb-1 fw-bold d-flex align-items-center gap-2">
              <span>Contractor List</span>
              <HelpHint darkMode={darkMode} text="Overview of organizations handling assignments and their current workload." />
            </h4>
            <div className="small" style={{ color: darkMode ? '#94a3b8' : '#6b7280' }}>Manage organizations linked to your system and review active assignments.</div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            {summaryStats.map((stat) => (
              <span
                key={stat.key}
                className="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill fw-semibold"
                style={{
                  fontSize: '0.86rem',
                  color: '#0f172a',
                  backgroundColor: stat.bg,
                  border: `1px solid ${stat.border}`
                }}
              >
                <span
                  className="rounded-circle"
                  style={{
                    width: '8px',
                    height: '8px',
                    backgroundColor: stat.color,
                    boxShadow: `0 0 0 2px ${stat.bg}`
                  }}
                />
                <span style={{ color: stat.color }}>{stat.value}</span>
                <span className="text-lowercase" style={{ color: '#334155' }}>{stat.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card border-0 shadow-sm p-4 text-muted"><LoadingText>Loading contractors</LoadingText></div>
      ) : error ? (
        <div className="card border-0 shadow-sm p-4 text-danger">{error}</div>
      ) : null}

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: '14px' }}>
        <div className="card-body">
          <h5 className="mb-2 fw-bold d-flex align-items-center gap-2">
            <span>Assigned Contractor Contacts</span>
            <HelpHint darkMode={darkMode} text="Contact matrix for assigned organizations and their linked report requests." />
          </h5>
          <div className="small mb-3" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
            Operational contact list for active simulation workflow assignments.
          </div>
          {assignmentList.length === 0 ? (
            <div className="small text-muted">No assignment contacts yet.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0" style={{ color: darkMode ? '#e2e8f0' : '#1f2937' }}>
                <thead>
                  <tr style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>
                    <th></th>
                    <th>Organization</th>
                    <th>Contract Email</th>
                    <th>Contact Person</th>
                    <th>Phone</th>
                    <th>Coverage</th>
                    <th className="text-end">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {assignmentList.map((item) => {
                    const isExpanded = expandedAssignmentKeys.has(item.assignmentKey);
                    const isHovered = hoveredAssignmentKey === item.assignmentKey;
                    const allRequests = item.requests || [];
                    const rowBackground = isExpanded
                      ? (darkMode ? 'rgba(59,130,246,0.22)' : '#dbeafe')
                      : (isHovered ? (darkMode ? '#25304a' : '#eef6ff') : (darkMode ? '#1e2540' : '#ffffff'));
                    const cellStyle = {
                      backgroundColor: rowBackground,
                      transition: 'background-color 0.18s ease, border-color 0.18s ease',
                      borderBottomColor: isHovered || isExpanded ? (darkMode ? 'rgba(147,197,253,0.45)' : '#bfdbfe') : undefined
                    };
                    return (
                      <React.Fragment key={item.assignmentKey}>
                        <tr
                          style={{
                            cursor: allRequests.length > 0 ? 'pointer' : 'default'
                          }}
                          onClick={() => {
                            if (allRequests.length > 0) toggleOrgExpanded(item.assignmentKey);
                          }}
                          onMouseEnter={() => setHoveredAssignmentKey(item.assignmentKey)}
                          onMouseLeave={() => setHoveredAssignmentKey('')}
                        >
                          <td
                            className="text-center"
                            style={{
                              ...cellStyle,
                              fontSize: '12px',
                              color: darkMode ? '#94a3b8' : '#666',
                              boxShadow: isHovered || isExpanded ? 'inset 3px 0 0 #3b82f6' : 'inset 3px 0 0 transparent'
                            }}
                          >
                            {allRequests.length > 0 ? (
                              <span
                                className="d-inline-flex align-items-center justify-content-center rounded-circle border"
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  fontSize: '12px',
                                  lineHeight: 1,
                                  color: isExpanded ? '#1d4ed8' : (darkMode ? '#94a3b8' : '#64748b'),
                                  borderColor: isExpanded ? '#93c5fd' : (darkMode ? 'rgba(148,163,184,0.38)' : '#cbd5e1'),
                                  backgroundColor: isExpanded ? '#dbeafe' : (darkMode ? '#1b2238' : '#f8fafc'),
                                  transition: 'all 0.18s ease'
                                }}
                              >
                                {isExpanded ? '-' : '+'}
                              </span>
                            ) : ''}
                          </td>
                          <td className="fw-semibold" style={{ ...cellStyle, color: darkMode ? '#e2e8f0' : '#0f172a' }}>{item.organization}</td>
                          <td style={cellStyle}>{item.contactEmail}</td>
                          <td style={cellStyle}>{item.contactPerson}</td>
                          <td style={cellStyle}>{item.phone}</td>
                          <td style={cellStyle}>{item.coverage}</td>
                          <td className="text-end" style={cellStyle}>
                            <span className="badge bg-warning text-dark">{item.active}</span>
                          </td>
                        </tr>
                        {allRequests.length > 0 && (
                          <tr>
                            <td
                              colSpan="7"
                              style={{
                                backgroundColor: darkMode ? '#1b2238' : '#fafafa',
                                padding: 0,
                                borderBottom: isExpanded ? undefined : '0'
                              }}
                            >
                              <div
                                style={{
                                  maxHeight: isExpanded ? '520px' : '0px',
                                  opacity: isExpanded ? 1 : 0,
                                  overflow: 'hidden',
                                  transition: 'max-height 0.28s ease, opacity 0.22s ease'
                                }}
                              >
                                <div style={{ padding: '12px' }}>
                                  <div className="small fw-semibold mb-2">Associated Images & Status</div>
                                  <div className="row g-2">
                                    {allRequests.map((request) => (
                                      <div className="col-12 col-md-6 col-lg-4" key={request.recordId}>
                                        <div
                                          className="border rounded p-2"
                                          role={typeof onOpenReport === 'function' ? 'button' : undefined}
                                          tabIndex={typeof onOpenReport === 'function' ? 0 : undefined}
                                          onClick={() => openReportFromRequest(request)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                              event.preventDefault();
                                              openReportFromRequest(request);
                                            }
                                          }}
                                          style={{
                                            backgroundColor: darkMode ? '#1e2540' : '#fff',
                                            borderColor: darkMode ? 'rgba(148,163,184,0.28)' : '#ddd',
                                            cursor: typeof onOpenReport === 'function' ? 'pointer' : 'default',
                                            transition: 'transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease'
                                          }}
                                          onMouseEnter={(event) => {
                                            event.currentTarget.style.transform = 'translateY(-2px)';
                                            event.currentTarget.style.boxShadow = '0 8px 16px rgba(15, 23, 42, 0.08)';
                                            event.currentTarget.style.borderColor = '#93c5fd';
                                          }}
                                          onMouseLeave={(event) => {
                                            event.currentTarget.style.transform = 'translateY(0)';
                                            event.currentTarget.style.boxShadow = 'none';
                                            event.currentTarget.style.borderColor = darkMode ? 'rgba(148,163,184,0.28)' : '#ddd';
                                          }}
                                        >
                                          <div className="d-flex justify-content-between align-items-start gap-2 mb-1">
                                            <span className="small fw-semibold text-truncate">#{String(request.recordId || '').slice(0, 8)}</span>
                                            <span className={`badge badge-sm ${statusBadgeClass(request.status)}`} style={{ fontSize: '11px' }}>{request.status || 'Unknown'}</span>
                                          </div>
                                          <div className="small text-muted text-truncate">{request.hazardClass || 'N/A'}</div>
                                          <div className="small text-muted text-truncate">{request.location || 'N/A'}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Least Cooperative Contractors — only shown when there are actual issues */}
      {contractors.length > 0 && (() => {
        // Only surface contractors that have at least one real negative signal
        const flagged = cooperativenessRanking.filter(
          (item) => item.rejected > 0 || item.overdueCount > 0 || (item.avgCompletionDays !== null && item.avgCompletionDays > 14)
        );
        const allGood = flagged.length === 0;

        return (
          <div className="card border-0 shadow-sm mb-4 mt-4" style={{ borderRadius: '14px' }}>
            <div className="card-body">
              <h5 className="mb-1 fw-bold d-flex align-items-center gap-2">
                <span>{allGood ? '✅ Contractor Performance' : '⚠️ Least Cooperative Contractors'}</span>
                <HelpHint darkMode={darkMode} text="Only contractors with rejections, overdue requests (open > 7 days), or slow completions (> 14 days) appear here. A clean list means all contractors are on track." />
              </h5>
              <div className="small mb-3" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                {allGood
                  ? 'All active contractors are performing within acceptable limits. No rejections, overdue requests, or slow completions detected.'
                  : 'Contractors flagged for rejections, overdue active requests (> 7 days open), or slow average completion time (> 14 days).'}
              </div>

              {allGood ? (
                <div className="d-flex align-items-center gap-3 p-3 rounded-3" style={{
                  background: darkMode ? 'rgba(34,197,94,0.08)' : '#f0fdf4',
                  border: `1px solid ${darkMode ? 'rgba(34,197,94,0.25)' : '#bbf7d0'}`
                }}>
                  <span style={{ fontSize: '2rem' }}>🏆</span>
                  <div>
                    <div className="fw-semibold" style={{ color: darkMode ? '#86efac' : '#15803d' }}>No issues detected</div>
                    <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>
                      {cooperativenessRanking.length} contractor{cooperativenessRanking.length !== 1 ? 's' : ''} tracked — all showing good cooperation. This panel will highlight underperformers when rejections or overdue requests occur.
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0" style={{ color: darkMode ? '#e2e8f0' : '#1f2937' }}>
                      <thead>
                        <tr style={{ color: darkMode ? '#cbd5e1' : '#334155', fontSize: '0.82rem' }}>
                          <th style={{ width: 36 }}>#</th>
                          <th>Organization</th>
                          <th className="text-center">Rejected</th>
                          <th className="text-center">Rejection Rate</th>
                          <th className="text-center">Overdue</th>
                          <th className="text-center">Avg Completion</th>
                          <th className="text-center">Score</th>
                          <th className="text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flagged.map((item, idx) => (
                          <tr key={item.name + idx} style={{ fontSize: '0.87rem' }}>
                            <td className="fw-bold" style={{ color: idx === 0 ? '#b91c1c' : (idx === 1 ? '#b45309' : (darkMode ? '#94a3b8' : '#64748b')) }}>
                              {idx + 1}
                            </td>
                            <td className="fw-semibold" style={{ color: darkMode ? '#e2e8f0' : '#0f172a', maxWidth: '200px' }}>
                              <div className="text-truncate">{item.name}</div>
                            </td>
                            <td className="text-center">
                              <span className="badge bg-danger">{item.rejected}</span>
                              <span className="text-muted small ms-1">/ {item.total}</span>
                            </td>
                            <td className="text-center" style={{ minWidth: '120px' }}>
                              <div className="d-flex align-items-center gap-2">
                                <div className="flex-grow-1" style={{ height: '6px', backgroundColor: darkMode ? '#334155' : '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                  <div style={{
                                    width: `${Math.min(100, item.rejectionRate * 100).toFixed(0)}%`,
                                    height: '100%',
                                    backgroundColor: item.rejectionRate >= 0.5 ? '#dc2626' : item.rejectionRate >= 0.2 ? '#f59e0b' : '#22c55e',
                                    borderRadius: '3px',
                                    transition: 'width 0.4s ease'
                                  }} />
                                </div>
                                <span style={{ fontSize: '0.78rem', minWidth: '32px', color: darkMode ? '#cbd5e1' : '#475569' }}>
                                  {(item.rejectionRate * 100).toFixed(0)}%
                                </span>
                              </div>
                            </td>
                            <td className="text-center">
                              {item.overdueCount > 0
                                ? <span className="badge bg-warning text-dark">{item.overdueCount} overdue</span>
                                : <span className="text-muted small">—</span>}
                            </td>
                            <td className="text-center">
                              {item.avgCompletionDays !== null
                                ? <span style={{ color: item.avgCompletionDays > 14 ? '#b91c1c' : item.avgCompletionDays > 7 ? '#b45309' : '#15803d', fontWeight: 600 }}>
                                    {item.avgCompletionDays.toFixed(1)}d
                                  </span>
                                : <span className="text-muted small">—</span>}
                            </td>
                            <td className="text-center">
                              <span className="fw-bold" style={{ fontSize: '0.9rem', color: item.badgeColor }}>
                                {item.score.toFixed(0)}
                              </span>
                            </td>
                            <td className="text-center">
                              <span className="badge rounded-pill px-2 py-1 fw-semibold" style={{
                                backgroundColor: item.badgeBg,
                                color: item.badgeColor,
                                border: `1px solid ${item.badgeColor}33`,
                                fontSize: '0.78rem'
                              }}>
                                {item.badge}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="small text-muted mt-2" style={{ fontSize: '0.75rem' }}>
                    Score: Rejection Rate (×40) + Overdue Rate (×40) + Completion Speed (×20). Overdue = active request open &gt; 7 days. Slow = avg completion &gt; 14 days.
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div className="card border-0 shadow-sm mt-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
            <h5 className="mb-0 fw-bold d-flex align-items-center gap-2">
              <span>Contractor Directory</span>
              <HelpHint darkMode={darkMode} text="Master list of organizations available for assignment, including add/remove actions." />
            </h5>
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-dark">{contractorDirectory.length} organizations</span>
              <button
                type="button"
                className={`btn btn-sm ${showAddForm ? 'btn-outline-secondary' : 'btn-primary'}`}
                onClick={() => setShowAddForm((current) => !current)}
              >
                {showAddForm ? 'Cancel' : 'Add Contractor'}
              </button>
            </div>
          </div>
          <div className="text-muted small mb-3">Admin can add or remove contractors associated with this system.</div>

          {showAddForm && (
            <form className="row g-2 mb-3" onSubmit={handleAddContractor}>
              <div className="col-12 col-md-6">
                <input className="form-control" placeholder="Organization name" value={newContractor.name} onChange={(event) => setNewContractor((current) => ({ ...current, name: event.target.value }))} required />
              </div>
              <div className="col-12 col-md-6">
                <input className="form-control" placeholder="Type (e.g. Expressway operator)" value={newContractor.type} onChange={(event) => setNewContractor((current) => ({ ...current, type: event.target.value }))} />
              </div>
              <div className="col-12 col-md-6">
                <input className="form-control" placeholder="Coverage" value={newContractor.coverage} onChange={(event) => setNewContractor((current) => ({ ...current, coverage: event.target.value }))} />
              </div>
              <div className="col-12 col-md-6">
                <input className="form-control" placeholder="Contact person" value={newContractor.contactPerson} onChange={(event) => setNewContractor((current) => ({ ...current, contactPerson: event.target.value }))} />
              </div>
              <div className="col-12 col-md-6">
                <input className="form-control" placeholder="Email" value={newContractor.email} onChange={(event) => setNewContractor((current) => ({ ...current, email: event.target.value }))} />
              </div>
              <div className="col-12 col-md-6">
                <input className="form-control" placeholder="Phone" value={newContractor.phone} onChange={(event) => setNewContractor((current) => ({ ...current, phone: event.target.value }))} />
              </div>
              <div className="col-12 col-md-8">
                <input className="form-control" placeholder="Domain hints (comma separated)" value={newContractor.domainHints} onChange={(event) => setNewContractor((current) => ({ ...current, domainHints: event.target.value }))} />
              </div>
              <div className="col-12 col-md-4 d-grid">
                <button type="submit" className="btn btn-primary" disabled={savingContractor}>
                  {savingContractor ? 'Saving...' : 'Save Contractor'}
                </button>
              </div>
            </form>
          )}

          {directoryError && (
            <div className={`alert ${directoryError.toLowerCase().includes('fallback') ? 'alert-warning' : 'alert-danger'} py-2`}>
              {directoryError}
            </div>
          )}
          {directoryLoading && <div className="small text-muted mb-3"><LoadingText>Loading contractor directory</LoadingText></div>}

          <div className="row g-3">
            {contractorDirectory.map((org) => (
              <div className="col-12 col-md-6 col-xl-4" key={org.id}>
                <div
                  className="border rounded-4 p-3 h-100 shadow-sm"
                  onMouseEnter={() => setHoveredDirectoryId(org.id)}
                  onMouseLeave={() => setHoveredDirectoryId('')}
                  style={{
                    backgroundColor: hoveredDirectoryId === org.id
                      ? (darkMode ? '#25304a' : '#f1f5f9')
                      : (darkMode ? '#1e2540' : '#f8fafc'),
                    borderColor: hoveredDirectoryId === org.id
                      ? '#93c5fd'
                      : (darkMode ? 'rgba(148,163,184,0.28)' : '#cbd5e1'),
                    color: darkMode ? '#e2e8f0' : '#0f172a',
                    transform: hoveredDirectoryId === org.id ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease',
                    boxShadow: hoveredDirectoryId === org.id
                      ? (darkMode ? '0 12px 22px rgba(0, 0, 0, 0.35)' : '0 10px 18px rgba(15, 23, 42, 0.08)')
                      : undefined
                  }}
                >
                  <div className="fw-semibold mb-1" style={{ color: darkMode ? '#e2e8f0' : '#0f172a' }}>{org.name}</div>
                  <div className="small mb-2" style={{ color: darkMode ? '#cbd5e1' : '#334155' }}>{org.type}</div>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#475569' }}>Coverage: {org.coverage}</div>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#475569' }}>Email: {org.email}</div>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#475569' }}>Phone: {org.phone}</div>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#475569' }}>Contact: {org.contactPerson}</div>
                  <div className="small" style={{ color: darkMode ? '#94a3b8' : '#64748b' }}>ID: {org.id}</div>
                  <div className="mt-2 d-flex justify-content-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      disabled={deletingId === org.id}
                      onClick={() => handleDeleteContractor(org)}
                    >
                      {deletingId === org.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(ContractorsPage);