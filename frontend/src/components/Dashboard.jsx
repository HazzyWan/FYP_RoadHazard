import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  MANUAL_HAZARD_OPTIONS,
  clamp01,
  drawAugmentedToCanvas,
  formatCoordinates,
  formatHazardLabel,
  formatLocationText,
  formatTimeAgo,
  getHazardBadgeClass,
  getLocationFilterLabel,
  hazardColor,
  normalizeBbox,
  normalizeHazardClass,
  normalizeStatus,
  sameNormalizedBbox,
  MALAYSIA_STATES
} from './dashboard/utils';
import AugmentationPage from './dashboard/AugmentationPage';
import ContractorsPage from './dashboard/ContractorsPage';
import LandingPage from './dashboard/LandingPage';
import ManagementPage from './dashboard/ManagementPage';
import { CONTRACTOR_DIRECTORY } from './dashboard/contractorDirectory';

const Dashboard = ({ setView, onLogout, API_URL, adminUser }) => {
  const REPAIR_SEEN_STORAGE_KEY = 'roadhazard_repair_seen_events';
  const IS_HOSTED_APP = typeof window !== 'undefined' && /(?:web\.app|firebaseapp\.com)$/i.test(window.location.hostname);
  // Derive a friendly display name and initials from the admin email
  const adminEmail = adminUser?.email || '';
  const adminDisplayName = adminEmail
    ? adminEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Admin';
  const adminInitials = adminDisplayName
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase() || 'AD';
  const [reports, setReports] = useState([]);
  const [allReports, setAllReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('All');
  const [filters, setFilters] = useState({ type: 'All Types', location: 'All states' });
  const [feedbackCorrect, setFeedbackCorrect] = useState(true);
  const [manualHazardClass, setManualHazardClass] = useState('pothole');
  const [targetDetectionIndex, setTargetDetectionIndex] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackTouched, setFeedbackTouched] = useState(false);
  const [manualTargetBbox, setManualTargetBbox] = useState(null);
  const [manualTargetBboxes, setManualTargetBboxes] = useState([]);
  const [feedbackProgress, setFeedbackProgress] = useState({
    loaded: false,
    enabled: false,
    pendingFeedbackCount: 0,
    minFeedback: 0,
    running: false,
    ready: false,
    lastState: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    cooldownRemainingSec: 0
  });
  const [datasetCounts, setDatasetCounts] = useState({
    loaded: false,
    totalImages: 0,
    reportTotalImages: 0,
    missingArchivedImages: 0,
    counts: {
      pothole: 0,
      alligator_crack: 0,
      longitudinal_crack: 0,
      crack: 0,
      not_hazard: 0
    },
    reportCounts: {
      pothole: 0,
      alligator_crack: 0,
      longitudinal_crack: 0,
      crack: 0,
      not_hazard: 0
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuHoverItem, setMenuHoverItem] = useState('');
  const [headerHoverItem, setHeaderHoverItem] = useState('');
  const [isMobileView, setIsMobileView] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 992 : false));
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('rh_darkMode') === 'true'; } catch { return false; }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [toast, setToast] = useState({ open: false, visible: false, message: '', type: 'info' });
  const [statusConfirm, setStatusConfirm] = useState({ open: false, visible: false, id: null, newStatus: '', rejectionNote: '' });
  const [contractorDirectory, setContractorDirectory] = useState([]);
  const [contractorPicker, setContractorPicker] = useState({
    open: false,
    visible: false,
    recordId: null,
    selectedId: '',
    submitting: false
  });
  const profileDropdownRef = useRef(null);
  const notificationDropdownRef = useRef(null);
  const toastTimerRef = useRef(null);
  const toastExitTimerRef = useRef(null);
  const confirmExitTimerRef = useRef(null);
  const contractorPickerExitTimerRef = useRef(null);
  const [dashboardPage, setDashboardPage] = useState('overview');
  const [augmentationRunning, setAugmentationRunning] = useState(false);
  const [augmentationConfig, setAugmentationConfig] = useState({
    maxItems: 1,
    triggerRetrain: false,
    includeConfidence: !IS_HOSTED_APP
  });
  const [augmentationControls, setAugmentationControls] = useState({
    sunGlare: true,
    rain: true,
    shadow: true,
    wetSurface: false,
    fog: false,
    lowLight: false,
    intensity: 0.55
  });
  const [augmentationSourceId, setAugmentationSourceId] = useState('');
  const [augmentationImage, setAugmentationImage] = useState(null);
  const [augmentationResult, setAugmentationResult] = useState(null);
  const [augmentationFeedbackCorrect, setAugmentationFeedbackCorrect] = useState(null);
  const [augmentationFeedbackClass, setAugmentationFeedbackClass] = useState('pothole');
  const [augmentationFeedbackNote, setAugmentationFeedbackNote] = useState('');
  const [augmentationFeedbackSaving, setAugmentationFeedbackSaving] = useState(false);
  const [augmentationTargetSelection, setAugmentationTargetSelection] = useState(null);
  const [showAugmentationCorrection, setShowAugmentationCorrection] = useState(false);
  const [datasetZipDownloading, setDatasetZipDownloading] = useState(false);
  const [seenRepairEventIds, setSeenRepairEventIds] = useState(() => {
    try {
      const raw = localStorage.getItem('roadhazard_repair_seen_events');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const augmentationCanvasRefs = useRef({});
  const previousAugmentationSourceIdRef = useRef('');
  const retrainStatusAuthDeniedRef = useRef(false);
  const datasetCountsAuthDeniedRef = useRef(false);

  // Persist dark mode preference
  useEffect(() => {
    try { localStorage.setItem('rh_darkMode', darkMode ? 'true' : 'false'); } catch { /* ignore */ }
  }, [darkMode]);

  // Close header dropdowns on outside click
  useEffect(() => {
    if (!profileOpen && !notificationOpen) return;
    const handler = (e) => {
      const outsideProfile = !(profileDropdownRef.current && profileDropdownRef.current.contains(e.target));
      const outsideNotification = !(notificationDropdownRef.current && notificationDropdownRef.current.contains(e.target));
      if (outsideProfile) setProfileOpen(false);
      if (outsideNotification) setNotificationOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen, notificationOpen]);

  useEffect(() => {
    const onResize = () => {
      if (typeof window === 'undefined') return;
      setIsMobileView(window.innerWidth < 992);
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!toast.open || !toast.visible) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toast.type === 'error') return;
    toastTimerRef.current = setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: false }));
    }, 2800);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [toast.open, toast.visible, toast.message, toast.type]);

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

  const showToast = (message, type = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current);
    setToast({ open: true, visible: false, message, type });
    setTimeout(() => {
      setToast((previous) => ({ ...previous, visible: true }));
    }, 10);
  };

  const openStatusConfirm = (id, newStatus) => {
    if (confirmExitTimerRef.current) clearTimeout(confirmExitTimerRef.current);
    setStatusConfirm({ open: true, visible: false, id, newStatus });
    setTimeout(() => {
      setStatusConfirm((previous) => ({ ...previous, visible: true }));
    }, 10);
  };

  const closeStatusConfirm = () => {
    setStatusConfirm((previous) => ({ ...previous, visible: false }));
    if (confirmExitTimerRef.current) clearTimeout(confirmExitTimerRef.current);
    confirmExitTimerRef.current = setTimeout(() => {
      setStatusConfirm({ open: false, visible: false, id: null, newStatus: '' });
    }, 200);
  };

  const locationFilterOptions = useMemo(() => {
    const observed = new Set();
    allReports.forEach((report) => {
      observed.add(getLocationFilterLabel(report));
    });

    const options = MALAYSIA_STATES.filter((state) => observed.has(state));
    if (observed.has('Other')) options.push('Other');
    return options;
  }, [allReports]);

  useEffect(() => {
    if (filters.location === 'All states') return;
    if (!locationFilterOptions.includes(filters.location)) {
      setFilters((current) => ({ ...current, location: 'All states' }));
    }
  }, [filters.location, locationFilterOptions]);

  const applyAutoRetrainProgress = (autoRetrain) => {
    if (!autoRetrain || typeof autoRetrain !== 'object') return;

    setFeedbackProgress((current) => ({
      ...current,
      loaded: true,
      enabled: Boolean(autoRetrain.enabled ?? current.enabled),
      pendingFeedbackCount: Number(autoRetrain.pendingFeedbackCount ?? current.pendingFeedbackCount ?? 0),
      minFeedback: Number(autoRetrain.minFeedback ?? autoRetrain.threshold ?? current.minFeedback ?? 0),
      running: Boolean(autoRetrain.running ?? current.running),
      ready: Boolean(autoRetrain.ready ?? current.ready),
      lastState: autoRetrain.lastState || current.lastState || null,
      lastStartedAt: autoRetrain.lastStartedAt || current.lastStartedAt || null,
      lastCompletedAt: autoRetrain.lastCompletedAt || current.lastCompletedAt || null,
      cooldownRemainingSec: Number(autoRetrain.cooldownRemainingSec ?? current.cooldownRemainingSec ?? 0)
    }));
  };

  const extractAutoRetrainPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.autoRetrain && typeof payload.autoRetrain === 'object') return payload.autoRetrain;

    const hasKnownField = [
      'enabled',
      'pendingFeedbackCount',
      'minFeedback',
      'threshold',
      'running',
      'ready'
    ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));

    return hasKnownField ? payload : null;
  };

  const closeContractorPicker = useCallback(() => {
    if (contractorPickerExitTimerRef.current) {
      clearTimeout(contractorPickerExitTimerRef.current);
    }
    setContractorPicker((current) => ({ ...current, visible: false }));
    contractorPickerExitTimerRef.current = setTimeout(() => {
      setContractorPicker({
        open: false,
        visible: false,
        recordId: null,
        selectedId: '',
        submitting: false
      });
    }, 180);
  }, []);

  const openContractorPicker = useCallback((recordId) => {
    if (!recordId) return;
    const defaultId = contractorDirectory[0]?.id || '';
    setContractorPicker({
      open: true,
      visible: false,
      recordId,
      selectedId: defaultId,
      submitting: false
    });
    setTimeout(() => {
      setContractorPicker((current) => ({ ...current, visible: true }));
    }, 20);
  }, [contractorDirectory]);

  const fetchContractorDirectory = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/contractor-directory`, {
        timeout: 12000,
        withCredentials: true,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 401
      });
      if (Number(response?.status || 0) === 401) {
        setContractorDirectory(CONTRACTOR_DIRECTORY);
        return;
      }
      const rows = Array.isArray(response?.data?.contractors) ? response.data.contractors : [];
      setContractorDirectory(rows.length ? rows : CONTRACTOR_DIRECTORY);
    } catch (directoryError) {
      console.error(directoryError);
      setContractorDirectory(CONTRACTOR_DIRECTORY);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchContractorDirectory();
  }, [fetchContractorDirectory]);

  useEffect(() => () => {
    if (contractorPickerExitTimerRef.current) {
      clearTimeout(contractorPickerExitTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setError(null);
        const retrainRequest = retrainStatusAuthDeniedRef.current
          ? Promise.resolve({ data: null, status: 401 })
          : axios.get(`${API_URL}/retrain_status`, {
              timeout: 12000,
              withCredentials: true,
              validateStatus: (status) => (status >= 200 && status < 300) || status === 401
            });

        const datasetCountsRequest = datasetCountsAuthDeniedRef.current
          ? Promise.resolve({ data: null, status: 401 })
          : axios.get(`${API_URL}/dataset_label_counts`, {
              timeout: 12000,
              withCredentials: true,
              validateStatus: (status) => (status >= 200 && status < 300) || status === 401
            });

        const [reportsResult, retrainResult, datasetCountsResult] = await Promise.allSettled([
          axios.get(`${API_URL}/reports`, { timeout: 12000, params: { limit: 500 } }),
          retrainRequest,
          datasetCountsRequest
        ]);

        if (reportsResult.status === 'fulfilled') {
          const incomingReports = Array.isArray(reportsResult.value?.data) ? reportsResult.value.data : [];
          const normalizedReports = incomingReports.map((report, index) => {
            const safeDetections = Array.isArray(report?.detections)
              ? report.detections.filter((item) => item && typeof item === 'object')
              : [];
            const safeWorkflow = report?.repairWorkflow && typeof report.repairWorkflow === 'object'
              ? report.repairWorkflow
              : null;
            const safeRecordId = String(report?.recordId || '').trim() || `unknown-${index}`;

            return {
              ...report,
              recordId: safeRecordId,
              detections: safeDetections,
              repairWorkflow: safeWorkflow,
              status: normalizeStatus(report?.status)
            };
          });
          const nowMs = Date.now();
          const safeTimestampMs = (report) => {
            const parsed = Date.parse(report?.timestamp || '');
            if (Number.isNaN(parsed)) return 0;
            if (parsed > nowMs + (5 * 60 * 1000)) return 0;
            return parsed;
          };
          const sortedReports = [...normalizedReports].sort((a, b) => safeTimestampMs(b) - safeTimestampMs(a));
          setAllReports(sortedReports);
        } else {
          throw reportsResult.reason;
        }

        let retrainPayload = null;
        if (retrainResult.status === 'fulfilled') {
          if (Number(retrainResult.value?.status || 0) === 401) {
            retrainStatusAuthDeniedRef.current = true;
          }
          retrainPayload = extractAutoRetrainPayload(retrainResult.value?.data);
        }

        if (!retrainPayload) {
          try {
            const fallbackResponse = await axios.get(`${API_URL}/health`, {
              timeout: 12000,
              withCredentials: true
            });
            retrainPayload = extractAutoRetrainPayload(fallbackResponse?.data);
          } catch {
            retrainPayload = null;
          }
        }

        if (retrainPayload) {
          applyAutoRetrainProgress(retrainPayload);
        } else {
          setFeedbackProgress((current) => ({
            ...current,
            loaded: true,
            enabled: false,
            pendingFeedbackCount: Number(current.pendingFeedbackCount ?? 0),
            minFeedback: Number(current.minFeedback ?? 0),
            running: false,
            ready: false,
            cooldownRemainingSec: 0
          }));
        }

        if (datasetCountsResult.status === 'fulfilled') {
          if (Number(datasetCountsResult.value?.status || 0) === 401) {
            datasetCountsAuthDeniedRef.current = true;
          }
          const payload = datasetCountsResult.value?.data || {};
          const incoming = payload.counts && typeof payload.counts === 'object' ? payload.counts : {};
          const reportIncoming = payload.reportCounts && typeof payload.reportCounts === 'object' ? payload.reportCounts : {};
          setDatasetCounts({
            loaded: true,
            totalImages: Number(payload.totalImages || 0),
            reportTotalImages: Number(payload.reportTotalImages || 0),
            missingArchivedImages: Number(payload.missingArchivedImages || 0),
            counts: {
              pothole: Number(incoming.pothole || 0),
              alligator_crack: Number(incoming.alligator_crack || 0),
              longitudinal_crack: Number(incoming.longitudinal_crack || 0),
              crack: Number(incoming.crack || 0),
              not_hazard: Number(incoming.not_hazard || 0)
            },
            reportCounts: {
              pothole: Number(reportIncoming.pothole || 0),
              alligator_crack: Number(reportIncoming.alligator_crack || 0),
              longitudinal_crack: Number(reportIncoming.longitudinal_crack || 0),
              crack: Number(reportIncoming.crack || 0),
              not_hazard: Number(reportIncoming.not_hazard || 0)
            }
          });
        } else {
          const status = datasetCountsResult.reason?.response?.status;
          if (status === 401) {
            setDatasetCounts({
              loaded: true,
              totalImages: 0,
              reportTotalImages: 0,
              missingArchivedImages: 0,
              counts: {
                pothole: 0,
                alligator_crack: 0,
                longitudinal_crack: 0,
                crack: 0,
                not_hazard: 0
              },
              reportCounts: {
                pothole: 0,
                alligator_crack: 0,
                longitudinal_crack: 0,
                crack: 0,
                not_hazard: 0
              }
            });
          }
        }
      } catch (err) {
        console.error(err);
        setError('Could not load reports. Check API at: ' + API_URL);
      } finally {
        setLoading(false);
      }
    };

    const refreshIntervalMs = 5000;
    let intervalId = null;
    let broadcastChannel = null;
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPolling = () => {
      if (intervalId || document.hidden) return;
      intervalId = setInterval(fetchReports, refreshIntervalMs);
    };

    const triggerImmediateRefresh = () => {
      fetchReports();
      startPolling();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }

      triggerImmediateRefresh();
    };

    const handleWindowFocus = () => {
      if (!document.hidden) {
        triggerImmediateRefresh();
      }
    };

    const handleReportsUpdated = () => {
      triggerImmediateRefresh();
    };

    fetchReports();

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('roadhazard:reports-updated', handleReportsUpdated);

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel('roadhazard-reports');
      broadcastChannel.onmessage = () => {
        triggerImmediateRefresh();
      };
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('roadhazard:reports-updated', handleReportsUpdated);
      if (broadcastChannel) {
        broadcastChannel.close();
        broadcastChannel = null;
      }
      stopPolling();
    };
  }, [API_URL]);

  // Filter reports based on active tab and filters
  useEffect(() => {
    let filtered = activeTab === 'All'
      ? allReports
      : allReports.filter(r => r.status === activeTab);

    if (filters.type !== 'All Types') {
      filtered = filtered.filter(r =>
        (r.detections || []).some(d => d.class?.toLowerCase() === filters.type.toLowerCase())
      );
    }

    if (filters.location !== 'All states') {
      filtered = filtered.filter(r => {
        const locationLabel = getLocationFilterLabel(r);
        return locationLabel.toLowerCase() === filters.location.toLowerCase();
      });
    }

    // Completed tab: sort by completedAt desc (most recently fixed first)
    if (activeTab === 'Completed') {
      filtered = [...filtered].sort((a, b) => {
        const aDate = Date.parse(a?.repairWorkflow?.completedAt || a?.timestamp || '');
        const bDate = Date.parse(b?.repairWorkflow?.completedAt || b?.timestamp || '');
        return (isNaN(bDate) ? 0 : bDate) - (isNaN(aDate) ? 0 : aDate);
      });
    }

    setReports(filtered);
    setSelectedReport((currentSelected) => {
      if (filtered.length === 0) return null;
      if (!currentSelected?.recordId) return filtered[0];

      const matched = filtered.find((r) => r.recordId === currentSelected.recordId);
      return matched || filtered[0];
    });
  }, [activeTab, filters, allReports]);

  useEffect(() => {
    if (augmentationSourceId || allReports.length === 0) return;
    const candidate = allReports.find((report) => Boolean((report?.mediaURL || '').trim()));
    if (candidate?.recordId) {
      setAugmentationSourceId(candidate.recordId);
    }
  }, [allReports, augmentationSourceId]);

  useEffect(() => {
    const selected = allReports.find((report) => report.recordId === augmentationSourceId);
    const mediaUrl = (selected?.mediaURL || '').trim();
    if (!mediaUrl) {
      setAugmentationImage(null);
      return;
    }

    const image = new Image();
    image.onload = () => setAugmentationImage(image);
    image.onerror = () => setAugmentationImage(null);
    image.src = mediaUrl;
  }, [allReports, augmentationSourceId]);

  useEffect(() => {
    const selected = allReports.find((report) => report.recordId === augmentationSourceId);
    const aiFeedback = selected?.aiFeedback || {};
    const sourceChanged = previousAugmentationSourceIdRef.current !== augmentationSourceId;

    if (sourceChanged) {
      setAugmentationFeedbackCorrect(null);
      const fallbackClass = (selected?.finalHazardClass || selected?.aiFeedback?.finalClass || 'pothole').toString().toLowerCase();
      const corrected = (aiFeedback?.correctedClass || fallbackClass || 'pothole').toString().toLowerCase();
      setAugmentationFeedbackClass(MANUAL_HAZARD_OPTIONS.includes(corrected) ? corrected : 'pothole');
      setAugmentationFeedbackNote(aiFeedback?.note || '');
      setShowAugmentationCorrection(false);
      setAugmentationTargetSelection(null);
      previousAugmentationSourceIdRef.current = augmentationSourceId;
    }
  }, [allReports, augmentationSourceId]);

  useEffect(() => {
    if (dashboardPage !== 'augmentation' || !augmentationImage) return;

    const refs = augmentationCanvasRefs.current;
    drawAugmentedToCanvas(refs.custom, augmentationImage, augmentationControls);
  }, [dashboardPage, augmentationImage, augmentationControls]);

  // Calculate statistics
  const stats = {
    all: allReports.length,
    pending: allReports.filter(r => r.status === 'Pending').length,
    verified: allReports.filter(r => r.status === 'Verified').length,
    requested: allReports.filter(r => r.status === 'Requested').length,
    inProgress: allReports.filter(r => r.status === 'In Progress').length,
    completed: allReports.filter(r => r.status === 'Completed').length,
    rejected: allReports.filter(r => r.status === 'Rejected').length,
    high: allReports.filter(r => {
      const maxConf = (r.detections || []).reduce((m, d) => Math.max(m, d.confidence ?? 0), 0);
      return maxConf >= 0.7;
    }).length,
    medium: allReports.filter(r => {
      const maxConf = (r.detections || []).reduce((m, d) => Math.max(m, d.confidence ?? 0), 0);
      return maxConf >= 0.4 && maxConf < 0.7;
    }).length,
    low: allReports.filter(r => {
      const maxConf = (r.detections || []).reduce((m, d) => Math.max(m, d.confidence ?? 0), 0);
      return maxConf < 0.4;
    }).length,
  };

  const handleMapView = () => {
    if (!selectedReport?.location) return;
    const { latitude, longitude } = selectedReport.location;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
    window.open(`https://www.google.com/maps?q=${latitude},${longitude}`, '_blank');
  };

  const submitStatusUpdate = async (id, newStatus, rejectionNote = '') => {
    try {
      const response = await axios.post(`${API_URL}/update_status`, { recordId: id, status: newStatus, rejectionNote: rejectionNote || '' });
      const normalizedNewStatus = normalizeStatus(newStatus);
      const payload = response?.data || {};
      const hasWorkflowField = Object.prototype.hasOwnProperty.call(payload, 'repairWorkflow');
      const workflow = hasWorkflowField ? (payload.repairWorkflow || null) : undefined;
      setAllReports(prev => prev.map(r => {
        if (r.recordId !== id) return r;
        if (!hasWorkflowField) return { ...r, status: normalizedNewStatus };
        return { ...r, status: normalizedNewStatus, repairWorkflow: workflow };
      }));
      setSelectedReport(prev => {
        if (prev?.recordId !== id) return prev;
        if (!hasWorkflowField) return { ...prev, status: normalizedNewStatus };
        return { ...prev, status: normalizedNewStatus, repairWorkflow: workflow };
      });

      const feedbackSaved = Boolean(response?.data?.feedbackSaved);
      const pendingCount = Number(response?.data?.pendingFeedbackCount ?? 0);
      const reporterNotification = response?.data?.reporterNotification || null;
      const reporterDeliverySucceeded = Boolean(reporterNotification?.deliverySucceeded);
      const reporterDeliveryAttempted = Boolean(reporterNotification?.attempted);
      const reporterFailureReason = [
        reporterNotification?.email?.message,
        reporterNotification?.reason
      ].filter(Boolean).join(' | ');
      applyAutoRetrainProgress(response?.data?.autoRetrain);
      if (feedbackSaved) {
        showToast(`Status updated to ${newStatus}. Feedback saved for training. Pending feedback: ${pendingCount}`, 'success');
      } else if (reporterDeliveryAttempted && !reporterDeliverySucceeded) {
        showToast(`Status updated to ${newStatus}, but reporter notification failed: ${reporterFailureReason || 'delivery failed'}.`, 'warning');
      } else {
        showToast(`Status updated to ${newStatus}.`, 'success');
      }
    } catch (error) {
      console.error(error);
      showToast('Failed to update status. Please make sure you are logged in and try again.', 'error');
    }
  };

  const handleStatusUpdate = (id, newStatus) => {
    openStatusConfirm(id, newStatus);
  };

  const handleSendRepairRequest = async (id) => {
    if (!id) return;
    if (!contractorDirectory.length) {
      showToast('No contractors available. Add one in Contractor List first.', 'warning');
      return;
    }
    openContractorPicker(id);
  };

  const submitRepairRequest = async () => {
    const recordId = contractorPicker.recordId;
    if (!recordId || !contractorPicker.selectedId) {
      showToast('Please select a contractor organization.', 'warning');
      return;
    }

    const selectedOrg = contractorDirectory.find((org) => org.id === contractorPicker.selectedId);
    if (!selectedOrg) {
      showToast('Selected contractor no longer exists. Refresh and try again.', 'warning');
      return;
    }

    setContractorPicker((current) => ({ ...current, submitting: true }));
    try {
      const response = await axios.post(`${API_URL}/repair/request`, {
        recordId,
        contractorEmail: selectedOrg.email,
        contractorOrganization: {
          id: selectedOrg.id,
          name: selectedOrg.name,
          type: selectedOrg.type,
          coverage: selectedOrg.coverage,
          email: selectedOrg.email,
          phone: selectedOrg.phone,
          contactPerson: selectedOrg.contactPerson,
          simulated: true
        }
      });

      const workflow = response?.data?.repairWorkflow;
      setAllReports((previous) => previous.map((report) => (
        report.recordId === recordId
          ? { ...report, status: 'Requested', ...(workflow ? { repairWorkflow: workflow } : {}) }
          : report
      )));
      setSelectedReport((previous) => (
        previous?.recordId === recordId
          ? { ...previous, status: 'Requested', ...(workflow ? { repairWorkflow: workflow } : {}) }
          : previous
      ));

      closeContractorPicker();
      const emailDelivery = response?.data?.emailDelivery || {};
      const reasonText = emailDelivery?.message ? ` ${emailDelivery.message}` : '';
      const emailSent = Boolean(emailDelivery?.sent);
      const toastType = emailSent ? 'success' : 'warning';
      const deliveryLabel = emailSent ? 'and email sent' : 'but email not sent';
      showToast(`Repair request assigned to ${selectedOrg.name} (simulation) ${deliveryLabel}.${reasonText}`, toastType);
    } catch (requestError) {
      console.error(requestError);
      const statusCode = Number(requestError?.response?.status || 0);
      const baseMessage = requestError?.response?.data?.error || 'Failed to submit repair request.';
      const message = statusCode === 401
        ? `${baseMessage} Hosted session may have expired. Please log in again on the hosted admin page.`
        : statusCode === 403
          ? `${baseMessage} Access blocked by backend policy (check Cloud Run auth/CORS config).`
          : baseMessage;
      showToast(message, 'error');
      setContractorPicker((current) => ({ ...current, submitting: false }));
    }
  };

  const handleSimulatePartnerUpdate = async (id, action) => {
    // Refresh sentinel: re-fetch the latest version of this single report from Firestore
    if (action === '__refresh__') {
      try {
        const response = await axios.get(`${API_URL}/reports`, { withCredentials: true, timeout: 15000 });
        const fresh = Array.isArray(response?.data) ? response.data : [];
        const refreshed = fresh.find((r) => r.recordId === id || r.recordId === id);
        if (refreshed) {
          setAllReports((previous) => previous.map((r) => r.recordId === id ? refreshed : r));
          setSelectedReport((previous) => previous?.recordId === id ? refreshed : previous);
          showToast('Report refreshed with latest contractor updates.', 'success');
        } else {
          showToast('Report not found in latest data.', 'warning');
        }
      } catch {
        showToast('Refresh failed. Try again.', 'error');
      }
      return;
    }
    try {
      const response = await axios.post(`${API_URL}/repair/simulate`, { recordId: id, action });
      const nextStatus = normalizeStatus(response?.data?.new_state || (action === 'accept' ? 'In Progress' : action === 'reject' ? 'Rejected' : 'Completed'));
      const workflow = response?.data?.repairWorkflow;
      const reporterNotification = response?.data?.reporterNotification || null;
      setAllReports((previous) => previous.map((report) => (
        report.recordId === id
          ? { ...report, status: nextStatus, ...(workflow ? { repairWorkflow: workflow } : {}) }
          : report
      )));
      setSelectedReport((previous) => (
        previous?.recordId === id
          ? { ...previous, status: nextStatus, ...(workflow ? { repairWorkflow: workflow } : {}) }
          : previous
      ));
      if (reporterNotification?.attempted && !reporterNotification?.deliverySucceeded) {
        const reason = [reporterNotification?.email?.message, reporterNotification?.reason]
          .filter(Boolean)
          .join(' | ');
        showToast(`Dummy contractor updated to ${nextStatus}, but reporter notification failed: ${reason || 'delivery failed'}.`, 'warning');
      } else {
        showToast(
          action === 'accept'
            ? 'Dummy contractor accepted request.'
            : action === 'reject'
              ? 'Dummy contractor rejected the request. Report moved back to Verified for reassignment.'
              : 'Dummy contractor marked repair completed.',
          'success'
        );
      }
    } catch (simulateError) {
      console.error(simulateError);
      showToast('Failed to simulate contractor update.', 'error');
    }
  };

  const handleOpenReportFromContractors = (recordId) => {
    if (!recordId) return;
    const matched = allReports.find((report) => report.recordId === recordId);
    if (matched) {
      setSelectedReport(matched);
    }
    setDashboardPage('management');
    setMenuOpen(false);
  };

  const repairNotifications = useMemo(() => {
    const events = [];
    allReports.forEach((report) => {
      const persistedEvents = Array.isArray(report?.repairEvents) ? report.repairEvents : [];
      persistedEvents.forEach((event) => {
        events.push({
          id: event?.id || `${report.recordId}-${event?.action || 'updated'}-${event?.at || ''}`,
          recordId: report.recordId,
          status: normalizeStatus(report.status),
          locationLabel: formatLocationText(report),
          hazardClass: report.finalHazardClass || (report.detections || [])[0]?.class || 'unknown',
          action: event?.action || 'updated',
          actor: event?.actor || 'system',
          note: event?.note || '',
          at: event?.at || null
        });
      });

      const workflow = report?.repairWorkflow;
      const workflowEvents = workflow && Array.isArray(workflow.events) ? workflow.events : [];
      workflowEvents.forEach((event) => {
        events.push({
          id: event?.id || `${report.recordId}-${event?.action || 'updated'}-${event?.at || ''}`,
          recordId: report.recordId,
          status: normalizeStatus(report.status),
          locationLabel: formatLocationText(report),
          hazardClass: report.finalHazardClass || (report.detections || [])[0]?.class || 'unknown',
          action: event?.action || 'updated',
          actor: event?.actor || 'system',
          note: event?.note || '',
          at: event?.at || null
        });
      });
    });

    return Array.from(new Map(events.map((item) => [item.id, item])).values())
      .sort((left, right) => Date.parse(right.at || '') - Date.parse(left.at || ''));
  }, [allReports]);

  const unreadRepairNotificationCount = useMemo(() => (
    repairNotifications.filter((event) => !seenRepairEventIds.includes(event.id)).length
  ), [repairNotifications, seenRepairEventIds]);

  useEffect(() => {
    try {
      localStorage.setItem(REPAIR_SEEN_STORAGE_KEY, JSON.stringify(seenRepairEventIds.slice(-300)));
    } catch {
      // Ignore localStorage failures.
    }
  }, [REPAIR_SEEN_STORAGE_KEY, seenRepairEventIds]);

  const markRepairNotificationSeen = (eventId) => {
    if (!eventId) return;
    setSeenRepairEventIds((previous) => (previous.includes(eventId) ? previous : [...previous, eventId]));
  };

  const markAllRepairNotificationsRead = () => {
    setSeenRepairEventIds((previous) => {
      const next = new Set(previous);
      repairNotifications.forEach((item) => {
        if (item?.id) next.add(item.id);
      });
      return Array.from(next);
    });
  };

  const openNotificationReport = (item) => {
    if (!item?.recordId) return;
    markRepairNotificationSeen(item.id);
    setNotificationOpen(false);
    setDashboardPage('management');
    setActiveTab('All');
    setFilters({ type: 'All Types', location: 'All states' });
    const target = allReports.find((report) => report.recordId === item.recordId);
    if (target) setSelectedReport(target);
  };

  useEffect(() => {
    const aiFeedback = selectedReport?.aiFeedback;
    if (typeof aiFeedback?.isCorrect === 'boolean') {
      setFeedbackCorrect(Boolean(aiFeedback.isCorrect));
    } else {
      setFeedbackCorrect(true);
    }

    if (aiFeedback?.correctedClass) {
      setManualHazardClass(aiFeedback.correctedClass);
    } else {
      const topDetection = (selectedReport?.detections || []).reduce((best, detection) => {
        const bestConf = best?.confidence ?? 0;
        const currentConf = detection?.confidence ?? 0;
        return currentConf > bestConf ? detection : best;
      }, selectedReport?.detections?.[0] || { class: 'pothole' });
      setManualHazardClass((topDetection?.class || 'pothole').toLowerCase());
    }

    setFeedbackNote(aiFeedback?.note || '');
    const savedTargetIndex = aiFeedback?.targetDetectionIndex;
    if (Number.isInteger(savedTargetIndex) && savedTargetIndex >= 0) {
      setTargetDetectionIndex(String(savedTargetIndex));
    } else {
      setTargetDetectionIndex('');
    }
    const savedTargetBboxesRaw = Array.isArray(aiFeedback?.targetDetectionBBoxes)
      ? aiFeedback.targetDetectionBBoxes
      : (aiFeedback?.targetDetectionBBox ? [aiFeedback.targetDetectionBBox] : []);
    const savedTargetBboxes = savedTargetBboxesRaw
      .map((bbox) => normalizeBbox(bbox || null))
      .filter(Boolean);
    const primaryTargetBbox = savedTargetBboxes[0] || normalizeBbox(aiFeedback?.targetDetectionBBox || null) || null;
    setManualTargetBboxes(savedTargetBboxes);
    setManualTargetBbox(primaryTargetBbox);
    setFeedbackTouched(false);
  }, [selectedReport?.recordId]);

  const handleFeedbackSubmit = async () => {
    if (!selectedReport?.recordId || feedbackSaving) return;
    if (!feedbackCorrect && !manualHazardClass) {
      showToast('Please choose the correct hazard class.', 'warning');
      return;
    }

    setFeedbackSaving(true);
    try {
      const payload = {
        recordId: selectedReport.recordId,
        isCorrect: feedbackCorrect,
        correctedClass: feedbackCorrect ? undefined : manualHazardClass,
        targetDetectionIndex: feedbackCorrect || targetDetectionIndex === '' ? undefined : Number(targetDetectionIndex),
        targetDetectionBBox: feedbackCorrect ? undefined : (manualTargetBboxes[0] || manualTargetBbox || undefined),
        targetDetectionBBoxes: feedbackCorrect ? undefined : (manualTargetBboxes.length > 0 ? manualTargetBboxes : undefined),
        note: feedbackNote
      };
      const response = await axios.post(`${API_URL}/feedback_detection`, payload);
      const selectedDetectionClass = (() => {
        if (!feedbackCorrect && targetDetectionIndex !== '') {
          const selected = selectedReport?.detections?.[Number(targetDetectionIndex)];
          return normalizeHazardClass(selected?.class || 'crack');
        }
        return (selectedReport?.detections || []).reduce((best, detection) => {
          const bestConf = best?.confidence ?? 0;
          const currentConf = detection?.confidence ?? 0;
          return currentConf > bestConf ? detection : best;
        }, selectedReport?.detections?.[0] || { class: 'crack' })?.class?.toLowerCase() || 'crack';
      })();
      const finalClass = normalizeHazardClass(response?.data?.finalClass || (feedbackCorrect ? selectedDetectionClass : manualHazardClass));

      setAllReports((previous) => previous.map((report) => {
        if (report.recordId !== selectedReport.recordId) return report;
        return {
          ...report,
          finalHazardClass: finalClass,
          aiFeedback: {
            isCorrect: feedbackCorrect,
            predictedClass: selectedDetectionClass,
            targetDetectionIndex: !feedbackCorrect && targetDetectionIndex !== '' ? Number(targetDetectionIndex) : null,
            targetDetectionBBox: !feedbackCorrect ? (manualTargetBbox || null) : null,
            targetDetectionBBoxes: !feedbackCorrect ? (manualTargetBboxes.length > 0 ? manualTargetBboxes : null) : null,
            correctedClass: feedbackCorrect ? (report.aiFeedback?.predictedClass || finalClass) : manualHazardClass,
            finalClass,
            note: feedbackNote
          },
          ...(finalClass === 'not_hazard' ? { status: 'Rejected' } : {})
        };
      }));

      applyAutoRetrainProgress(response?.data?.autoRetrain);

      showToast(
        response?.data?.autoRetrain?.enabled
          ? `Feedback saved. Pending training samples: ${response?.data?.pendingFeedbackCount ?? 0}`
          : 'Feedback saved.',
        'success'
      );
      setFeedbackTouched(false);
    } catch (submitError) {
      console.error(submitError);
      showToast('Failed to save feedback. Please try again.', 'error');
    } finally {
      setFeedbackSaving(false);
    }
  };

  const selectedDetections = selectedReport?.detections || [];
  const selectedStatus = normalizeStatus(selectedReport?.status);
  const isSelectedRejected = selectedStatus === 'Rejected';
  const detectionsWithBbox = selectedDetections
    .map((detection) => ({ ...detection, normalizedBbox: normalizeBbox(detection?.bbox) }))
    .filter((detection) => detection.normalizedBbox);
  const hasBoundingBoxes = detectionsWithBbox.length > 0;
  const percent = (value) => `${(clamp01(value) * 100).toFixed(3)}%`;
  const hazardTypeOptions = Array.from(
    new Set(
      allReports.flatMap((report) =>
        (report.detections || [])
          .map((detection) => normalizeHazardClass(detection?.class || ''))
          .filter(Boolean)
      )
    )
  ).sort((a, b) => a.localeCompare(b));
  const feedbackRemaining = Math.max((feedbackProgress.minFeedback || 0) - (feedbackProgress.pendingFeedbackCount || 0), 0);
  const lastRetrainLabel = feedbackProgress.lastStartedAt
    ? formatTimeAgo(feedbackProgress.lastStartedAt)
    : 'Never';
  const lastCompletedLabel = feedbackProgress.lastCompletedAt
    ? formatTimeAgo(feedbackProgress.lastCompletedAt)
    : 'Never';
  const cooldownMinutes = Math.ceil((feedbackProgress.cooldownRemainingSec || 0) / 60);
  const dashboardOverview = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const overdueRequestMs = 3 * oneDayMs;

    const parseTime = (value) => {
      const parsed = Date.parse(String(value || ''));
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const getCompletedAtMs = (report) => {
      const workflow = report?.repairWorkflow || {};
      const directCompletion = parseTime(
        workflow?.completedAt || report?.completedAt || workflow?.updatedAt || report?.updatedAt
      );
      if (directCompletion > 0) return directCompletion;

      const events = Array.isArray(workflow?.events) ? workflow.events : [];
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index] || {};
        const action = String(event?.action || event?.state || '').toLowerCase();
        if (action.includes('complete')) {
          const eventTime = parseTime(event?.timestamp || event?.at || event?.createdAt || event?.updatedAt);
          if (eventTime > 0) return eventTime;
        }
      }
      return 0;
    };

    const reportsToday = allReports.filter((report) => parseTime(report?.timestamp) >= startOfToday);
    const completedToday = allReports.filter((report) => (
      normalizeStatus(report?.status) === 'Completed' && getCompletedAtMs(report) >= startOfToday
    ));

    const dailyCompletionTrend = Array.from({ length: 14 }, (_, idx) => {
      const dayStart = startOfToday - ((13 - idx) * oneDayMs);
      const dayEnd = dayStart + oneDayMs;
      const count = allReports.filter((report) => {
        if (normalizeStatus(report?.status) !== 'Completed') return false;
        const completedAtMs = getCompletedAtMs(report);
        return completedAtMs >= dayStart && completedAtMs < dayEnd;
      }).length;
      const labelDate = new Date(dayStart);
      const dayLabel = `${labelDate.toLocaleString('en-US', { month: 'short' })} ${labelDate.getDate()}`;
      return { dayStart, dayLabel, count };
    });

    const correctedReports = allReports.filter((report) => report?.aiFeedback?.isCorrect === false);
    const aiReviewedCount = allReports.filter((report) => {
      if ((report?.detections || []).length > 0) return true;
      return typeof report?.aiFeedback?.isCorrect === 'boolean';
    }).length;

    const nonAiProcessedReports = allReports
      .filter((report) => {
        const hasDetections = (report?.detections || []).length > 0;
        const hasAiFeedback = typeof report?.aiFeedback?.isCorrect === 'boolean';
        return !hasDetections && !hasAiFeedback;
      })
      .map((report) => {
        const mediaUrl = String(report?.mediaURL || '').trim();
        const baseUrl = mediaUrl.split('?')[0] || mediaUrl;
        const fileName = baseUrl.split('/').filter(Boolean).pop() || 'unknown_file';
        return {
          recordId: report?.recordId,
          status: normalizeStatus(report?.status),
          timestamp: report?.timestamp,
          mediaURL: mediaUrl,
          fileName
        };
      });

    const falseNegativeCount = allReports.filter((report) => {
      if (report?.aiFeedback?.isCorrect !== false) return false;
      const predicted = normalizeHazardClass(report?.aiFeedback?.predictedClass || '');
      const finalClass = normalizeHazardClass(report?.aiFeedback?.finalClass || report?.finalHazardClass || '');
      const noDetections = (report?.detections || []).length === 0;
      return finalClass !== 'not_hazard' && (predicted === 'not_hazard' || noDetections);
    }).length;

    const highPriorityQueue = allReports
      .filter((report) => {
        const status = normalizeStatus(report?.status);
        return status === 'Pending' || status === 'Verified' || status === 'Requested';
      })
      .map((report) => {
        const maxConfidence = (report?.detections || []).reduce((best, detection) => (
          Math.max(best, Number(detection?.confidence || 0))
        ), 0);
        return { ...report, _maxConfidence: maxConfidence };
      })
      .sort((a, b) => b._maxConfidence - a._maxConfidence)
      .slice(0, 5);

    const unassignedCount = allReports.filter((report) => {
      const status = normalizeStatus(report?.status);
      if (status !== 'Verified') return false;
      return !report?.repairWorkflow?.requestedAt;
    }).length;

    const overdueRequestedCount = allReports.filter((report) => {
      const status = normalizeStatus(report?.status);
      if (status !== 'Requested') return false;
      const requestedAtMs = parseTime(report?.repairWorkflow?.requestedAt || report?.timestamp);
      return requestedAtMs > 0 && (Date.now() - requestedAtMs) > overdueRequestMs;
    }).length;

    const partnerRejectedCount = allReports.filter((report) => {
      const workflow = report?.repairWorkflow || {};
      if (String(workflow?.state || '').toLowerCase() === 'rejected') return true;
      const events = Array.isArray(workflow?.events) ? workflow.events : [];
      return events.some((event) => String(event?.action || '').toLowerCase().includes('reject'));
    }).length;

    // Compute top hazards by class
    const hazardCounts = {};
    allReports.forEach((report) => {
      const detections = Array.isArray(report?.detections) ? report.detections : [];
      detections.forEach((detection) => {
        const hazardClass = normalizeHazardClass(detection?.class || '');
        if (hazardClass && hazardClass !== 'not_hazard') {
          hazardCounts[hazardClass] = (hazardCounts[hazardClass] || 0) + 1;
        }
      });
    });

    const topHazards = Object.entries(hazardCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const contractorPerformanceMap = new Map();
    const OVERDUE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const nowMs = Date.now();

    // Build a quick lookup: email/domain → org name from the directory
    const resolveOrgName = (workflow) => {
      if (workflow?.contractorOrganizationName) return workflow.contractorOrganizationName;
      const email = String(workflow?.contractorOrganizationEmail || workflow?.contractorEmail || '').toLowerCase();
      if (email && contractorDirectory.length) {
        const match = contractorDirectory.find((org) =>
          org.email?.toLowerCase() === email ||
          (org.domainHints || []).some((hint) => email.includes(String(hint).toLowerCase()))
        );
        if (match?.name) return match.name;
      }
      return workflow?.contractorOrganizationId || workflow?.contractorEmail || '';
    };

    allReports.forEach((report) => {
      const workflow = report?.repairWorkflow || {};
      const contractorName = String(resolveOrgName(workflow)).trim();
      if (!contractorName) return;

      const key = contractorName.toLowerCase();
      const current = contractorPerformanceMap.get(key) || {
        key,
        name: contractorName,
        totalRequests: 0,
        completed: 0,
        rejected: 0,
        active: 0,
        overdueCount: 0,
        totalCompletionMs: 0,
        completionSamples: 0
      };

      const status = normalizeStatus(report?.status);
      const workflowState = String(workflow?.state || '').toLowerCase();
      if (status === 'Requested' || status === 'In Progress' || status === 'Completed' || status === 'Rejected') {
        current.totalRequests += 1;
      }
      if (status === 'Completed' || workflowState === 'completed') {
        current.completed += 1;
      }
      if (status === 'Rejected' || workflowState === 'rejected') {
        current.rejected += 1;
      }
      if (status === 'Requested' || status === 'In Progress') {
        current.active += 1;
        // Flag overdue: active request open more than 7 days
        const requestedAt = workflow?.requestedAt ? Date.parse(workflow.requestedAt) : null;
        if (requestedAt && (nowMs - requestedAt) > OVERDUE_THRESHOLD_MS) {
          current.overdueCount += 1;
        }
      }
      // Accumulate completion time for avg calculation
      const requestedAt = workflow?.requestedAt ? Date.parse(workflow.requestedAt) : null;
      const completedAt = workflow?.completedAt ? Date.parse(workflow.completedAt) : null;
      if (requestedAt && completedAt && completedAt > requestedAt) {
        current.totalCompletionMs += (completedAt - requestedAt);
        current.completionSamples += 1;
      }

      contractorPerformanceMap.set(key, current);
    });

    const contractorPerformance = Array.from(contractorPerformanceMap.values()).map((item) => {
      const resolvedCount = Number(item.completed || 0) + Number(item.rejected || 0);
      const completionRate = resolvedCount > 0 ? Number(item.completed || 0) / resolvedCount : 0;
      const avgCompletionDays = item.completionSamples > 0
        ? (item.totalCompletionMs / item.completionSamples) / (1000 * 60 * 60 * 24)
        : null;
      const rejectionRate = item.totalRequests > 0 ? item.rejected / item.totalRequests : 0;
      const overdueRate = item.active > 0 ? item.overdueCount / item.active : 0;
      const completionScore = avgCompletionDays !== null ? Math.min(20, (avgCompletionDays / 14) * 20) : 0;
      const cooperationScore = (rejectionRate * 40) + (overdueRate * 40) + completionScore;
      return {
        ...item,
        resolvedCount,
        completionRate,
        avgCompletionDays,
        rejectionRate,
        overdueRate,
        cooperationScore  // higher = less cooperative
      };
    });

    return {
      reportsToday: reportsToday.length,
      completedToday: completedToday.length,
      unresolvedCount: stats.pending + stats.verified + stats.requested + stats.inProgress,
      aiReviewedCount,
      correctedCount: correctedReports.length,
      correctionRate: aiReviewedCount > 0 ? (correctedReports.length / aiReviewedCount) : 0,
      falseNegativeCount,
      retrainEnabled: Boolean(feedbackProgress.enabled),
      retrainRunning: Boolean(feedbackProgress.running),
      pendingFeedbackCount: Number(feedbackProgress.pendingFeedbackCount || 0),
      feedbackThreshold: Number(feedbackProgress.minFeedback || 0),
      cooldownMinutes,
      lastRetrainLabel,
      lastCompletedLabel,
      highPriorityQueue,
      unassignedCount,
      overdueRequestedCount,
      partnerRejectedCount,
      unreadRepairNotificationCount,
      topHazards,
      nonAiProcessedReports,
      dailyCompletionTrend,
      contractorPerformance,
      aiReviewedCountExplanation: `${aiReviewedCount} reports with detections or feedback out of ${allReports.length} total`
    };
  }, [
    allReports,
    stats.pending,
    stats.verified,
    stats.requested,
    stats.inProgress,
    feedbackProgress.enabled,
    feedbackProgress.running,
    feedbackProgress.pendingFeedbackCount,
    feedbackProgress.minFeedback,
    cooldownMinutes,
    lastRetrainLabel,
    lastCompletedLabel,
    unreadRepairNotificationCount,
    contractorDirectory
  ]);

  const describeRetrainState = (state, fallbackPendingCount = 0, fallbackThreshold = 0, fallbackCooldownSec = 0) => {
    const raw = String(state || '').trim();
    if (!raw) return 'Retrain not started yet.';

    if (raw === 'disabled') {
      return 'Auto retrain is disabled on hosted backend.';
    }

    if (raw === 'already_running') {
      return 'Retrain is already running. Please wait for completion.';
    }

    if (raw.startsWith('cooldown_')) {
      const secFromState = Number(raw.replace('cooldown_', ''));
      const sec = Number.isFinite(secFromState) && secFromState > 0
        ? secFromState
        : Number(fallbackCooldownSec || 0);
      const min = Math.max(1, Math.ceil(sec / 60));
      return `Retrain is cooling down. Try again in about ${min} minute(s).`;
    }

    if (raw.startsWith('need_') && raw.includes('_have_')) {
      const match = raw.match(/^need_(\d+)_have_(\d+)$/);
      const threshold = match ? Number(match[1]) : Number(fallbackThreshold || 0);
      const have = match ? Number(match[2]) : Number(fallbackPendingCount || 0);
      const remaining = Math.max((threshold || 0) - (have || 0), 0);
      return `Retrain not started. Need ${threshold} feedback item(s), currently ${have}. Add ${remaining} more and try again.`;
    }

    if (raw.startsWith('triggered_with_')) {
      const count = Number(raw.replace('triggered_with_', ''));
      if (Number.isFinite(count)) {
        return `Retrain started with ${count} pending feedback item(s).`;
      }
      return 'Retrain started successfully.';
    }

    return `Retrain not started (${raw}).`;
  };

  const handleRetrainNow = async () => {
    try {
      const response = await axios.post(`${API_URL}/retrain_now`, {});
      const started = Boolean(response?.data?.started);
      const state = response?.data?.state || 'unknown';
      const pendingCount = Number(response?.data?.pendingFeedbackCount ?? 0);
      const cooldownSec = Number(response?.data?.cooldownRemainingSec ?? 0);
      const threshold = Number(response?.data?.threshold ?? 0);

      applyAutoRetrainProgress(response?.data?.autoRetrain);

      if (started) {
        showToast(describeRetrainState(state, pendingCount, threshold, cooldownSec), 'success');
        return;
      }

      if (String(state).startsWith('cooldown_')) {
        showToast(describeRetrainState(state, pendingCount, threshold, cooldownSec), 'warning');
        return;
      }

      showToast(describeRetrainState(state, pendingCount, threshold, cooldownSec), 'warning');
    } catch (error) {
      console.error(error);
      showToast('Failed to trigger retrain. Check backend logs.', 'error');
    }
  };

  const handleDownloadCorrectedLabelsZip = async () => {
    if (datasetZipDownloading) return;

    setDatasetZipDownloading(true);
    try {
      const response = await axios.get(`${API_URL}/dataset_labels_zip`, {
        params: { correctedOnly: true },
        withCredentials: true,
        responseType: 'blob',
        timeout: 60000
      });

      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      const disposition = response.headers?.['content-disposition'] || '';
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      anchor.href = blobUrl;
      anchor.download = filenameMatch?.[1] || `dataset_labels_corrected_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      console.error(downloadError);
      showToast(downloadError?.response?.data?.error || 'Failed to download corrected labels ZIP.', 'error');
    } finally {
      setDatasetZipDownloading(false);
    }
  };

  const handleRunAugmentation = async () => {
    if (augmentationRunning) return;

    const effectiveSourceId = (augmentationSourceId || '').trim();

    setAugmentationRunning(true);
    setAugmentationResult(null);
    try {
      const payload = {
        maxItems: Number(augmentationConfig.maxItems || 20),
        triggerRetrain: Boolean(augmentationConfig.triggerRetrain),
        includeConfidence: Boolean(augmentationConfig.includeConfidence),
        sourceRecordId: effectiveSourceId || undefined,
        controls: augmentationControls
      };
      const response = await axios.post(`${API_URL}/augment_submissions`, payload, {
        withCredentials: true,
        timeout: 420000
      });

      setAugmentationResult({
        ...(response?.data || {}),
        _meta: {
          confidenceRequested: Boolean(effectiveSourceId) && Boolean(payload.includeConfidence),
          confidenceEnabled: Boolean(payload.includeConfidence),
          sourceRecordId: effectiveSourceId || null,
          runAt: new Date().toISOString()
        }
      });
      applyAutoRetrainProgress(response?.data?.autoRetrain);
    } catch (augmentationError) {
      console.error(augmentationError);
      const timeoutMs = Number(augmentationError?.config?.timeout || 0);
      const timeoutSec = timeoutMs > 0 ? Math.round(timeoutMs / 1000) : 180;
      const statusCode = Number(augmentationError?.response?.status || 0);
      const isTimeout = augmentationError?.code === 'ECONNABORTED' || /timeout/i.test(String(augmentationError?.message || ''));
      const errorMessage = isTimeout
        ? `Image augmentation timed out after ${timeoutSec}s. Try lowering "Reports to sample" (for example to 5-10) and run again.`
        : statusCode === 401
          ? 'Your admin session expired. Please log in again, then retry augmentation.'
          : (augmentationError?.response?.data?.error || 'Failed to run image augmentation.');
      setAugmentationResult({
        error: errorMessage,
        _meta: {
          confidenceRequested: Boolean(effectiveSourceId) && Boolean(augmentationConfig.includeConfidence),
          confidenceEnabled: Boolean(augmentationConfig.includeConfidence),
          sourceRecordId: effectiveSourceId || null,
          runAt: new Date().toISOString()
        }
      });
    } finally {
      setAugmentationRunning(false);
    }
  };

  const handleAugmentationFeedbackSubmit = async () => {
    if (!augmentationSourceId || augmentationFeedbackSaving) return;
    if (augmentationFeedbackCorrect !== true && augmentationFeedbackCorrect !== false) {
      showToast('Please choose whether the prediction is correct or wrong.', 'warning');
      return;
    }
    if (augmentationFeedbackCorrect === false && !augmentationFeedbackClass) {
      showToast('Please choose the correct hazard class.', 'warning');
      return;
    }

    setAugmentationFeedbackSaving(true);
    try {
      const payload = {
        recordId: augmentationSourceId,
        isCorrect: augmentationFeedbackCorrect,
        correctedClass: augmentationFeedbackCorrect === true ? undefined : augmentationFeedbackClass,
        predictedClass: augmentationTargetSelection?.predictedClass || augmentationPredictedClass,
        targetDetectionBBox: augmentationFeedbackCorrect === false ? augmentationTargetSelection?.bbox : undefined,
        note: augmentationFeedbackNote
      };
      const response = await axios.post(`${API_URL}/feedback_detection`, payload);
      const finalClass = normalizeHazardClass(response?.data?.finalClass || augmentationFeedbackClass || 'crack');

      setAllReports((previous) => previous.map((report) => {
        if (report.recordId !== augmentationSourceId) return report;
        return {
          ...report,
          finalHazardClass: finalClass,
          aiFeedback: {
            ...(report.aiFeedback || {}),
            isCorrect: augmentationFeedbackCorrect,
            predictedClass: augmentationTargetSelection?.predictedClass || augmentationPredictedClass,
            targetDetectionBBox: augmentationFeedbackCorrect === false ? (augmentationTargetSelection?.bbox || null) : null,
            correctedClass: augmentationFeedbackCorrect === true
              ? (((augmentationTargetSelection?.predictedClass || report.aiFeedback?.predictedClass || finalClass)).toString().toLowerCase())
              : augmentationFeedbackClass,
            finalClass,
            note: augmentationFeedbackNote
          },
          ...(finalClass === 'not_hazard' ? { status: 'Rejected' } : {})
        };
      }));

      applyAutoRetrainProgress(response?.data?.autoRetrain);
      showToast(
        response?.data?.autoRetrain?.enabled
          ? `Correction saved. Pending training samples: ${response?.data?.pendingFeedbackCount ?? 0}`
          : 'Correction saved.',
        'success'
      );
    } catch (submitError) {
      console.error(submitError);
      showToast('Failed to save correction. Please try again.', 'error');
    } finally {
      setAugmentationFeedbackSaving(false);
    }
  };

  const confidenceScenarios = augmentationResult?.confidenceAnalysis?.scenarios || [];
  const confidenceConsensus = augmentationResult?.confidenceAnalysis?.consensus || null;
  const confidenceError = augmentationResult?.confidenceAnalysis?.error;
  const confidenceSkipped = Boolean(augmentationResult?.confidenceAnalysis?.skipped);
  const confidenceSkipReason = augmentationResult?.confidenceAnalysis?.reason || null;
  const confidenceRequested = Boolean(augmentationResult?._meta?.confidenceRequested) && !augmentationResult?.error && !confidenceSkipped;
  const augmentationSourceReport = allReports.find((report) => report.recordId === augmentationSourceId) || null;
  const augmentationFallbackPrediction = (() => {
    const originalScenario = confidenceScenarios.find((scenario) => String(scenario?.scenario || '').toLowerCase() === 'original');
    if (originalScenario?.detected && originalScenario?.topClass) return String(originalScenario.topClass).toLowerCase();
    const topDetection = (augmentationSourceReport?.detections || []).reduce((best, detection) => {
      const bestConf = best?.confidence ?? 0;
      const currentConf = detection?.confidence ?? 0;
      return currentConf > bestConf ? detection : best;
    }, augmentationSourceReport?.detections?.[0] || null);
    return normalizeHazardClass(topDetection?.class || augmentationSourceReport?.finalHazardClass || 'crack');
  })();
  const augmentationPredictedClass = normalizeHazardClass(confidenceConsensus?.hazardClass || augmentationFallbackPrediction || 'crack');
  const selectedAugmentationTargetLabel = augmentationTargetSelection
    ? `${formatHazardLabel(augmentationTargetSelection.predictedClass || 'unknown')} • ${formatHazardLabel(String(augmentationTargetSelection.scenarioTitle || '').replace(/_/g, ' '))} • ${((augmentationTargetSelection.confidence || 0) * 100).toFixed(1)}%`
    : '';
  const confidenceRunAt = augmentationResult?._meta?.runAt
    ? new Date(augmentationResult._meta.runAt).toLocaleTimeString()
    : null;

  const augmentationProps = useMemo(() => ({
    setDashboardPage,
    augmentationSourceId,
    setAugmentationSourceId,
    allReports,
    formatLocationText,
    augmentationControls,
    setAugmentationControls,
    augmentationConfig,
    setAugmentationConfig,
    handleRunAugmentation,
    augmentationRunning,
    augmentationCanvasRefs,
    confidenceScenarios,
    confidenceError,
    confidenceSkipped,
    confidenceSkipReason,
    confidenceRequested,
    confidenceRunAt,
    confidenceConsensus,
    formatHazardLabel,
    showAugmentationCorrection,
    setShowAugmentationCorrection,
    augmentationPredictedClass,
    selectedAugmentationTargetLabel,
    setAugmentationTargetSelection,
    augmentationFeedbackCorrect,
    setAugmentationFeedbackCorrect,
    augmentationFeedbackClass,
    setAugmentationFeedbackClass,
    MANUAL_HAZARD_OPTIONS,
    augmentationFeedbackNote,
    setAugmentationFeedbackNote,
    handleAugmentationFeedbackSubmit,
    augmentationFeedbackSaving,
    normalizeBbox,
    augmentationTargetSelection,
    sameNormalizedBbox,
    hazardColor,
    normalizeHazardClass,
    percent,
    getHazardBadgeClass,
    augmentationResult,
    darkMode
  }), [
    darkMode,
    setDashboardPage,
    augmentationSourceId,
    setAugmentationSourceId,
    allReports,
    augmentationControls,
    setAugmentationControls,
    augmentationConfig,
    setAugmentationConfig,
    handleRunAugmentation,
    augmentationRunning,
    augmentationCanvasRefs,
    confidenceScenarios,
    confidenceError,
    confidenceSkipped,
    confidenceSkipReason,
    confidenceRequested,
    confidenceRunAt,
    confidenceConsensus,
    showAugmentationCorrection,
    setShowAugmentationCorrection,
    augmentationPredictedClass,
    selectedAugmentationTargetLabel,
    setAugmentationTargetSelection,
    augmentationFeedbackCorrect,
    setAugmentationFeedbackCorrect,
    augmentationFeedbackClass,
    setAugmentationFeedbackClass,
    augmentationFeedbackNote,
    setAugmentationFeedbackNote,
    handleAugmentationFeedbackSubmit,
    augmentationFeedbackSaving,
    augmentationTargetSelection,
    augmentationResult
  ]);

  const managementProps = useMemo(() => ({
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
    formatCoordinates,
    selectedStatus,
    isSelectedRejected,
    feedbackCorrect,
    setFeedbackCorrect,
    setFeedbackTouched,
    feedbackSaving,
    targetDetectionIndex,
    setTargetDetectionIndex,
    manualTargetBbox,
    setManualTargetBbox,
    manualTargetBboxes,
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
    darkMode
  }), [
    darkMode,
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
    hasBoundingBoxes,
    detectionsWithBbox,
    selectedDetections,
    selectedStatus,
    isSelectedRejected,
    feedbackCorrect,
    setFeedbackCorrect,
    setFeedbackTouched,
    feedbackSaving,
    targetDetectionIndex,
    setTargetDetectionIndex,
    manualTargetBbox,
    setManualTargetBbox,
    manualTargetBboxes,
    setManualTargetBboxes,
    manualHazardClass,
    setManualHazardClass,
    feedbackNote,
    setFeedbackNote,
    handleFeedbackSubmit,
    feedbackTouched,
    handleStatusUpdate,
    handleMapView,
    handleSendRepairRequest,
    handleSimulatePartnerUpdate
  ]);

  const sideMenuItems = [
    { key: 'overview', label: 'Dashboard Overview' },
    { key: 'management', label: 'Hazard Management' },
    { key: 'augmentation', label: 'Image Augmentation' },
    { key: 'contractors', label: 'Contractor List' }
  ];

  const sideMenuItemStyle = (itemKey) => ({
    backgroundColor: (dashboardPage === itemKey || menuHoverItem === itemKey)
      ? (darkMode ? 'rgba(59,130,246,0.18)' : '#eff6ff')
      : 'transparent',
    borderLeft: dashboardPage === itemKey ? '3px solid #3b82f6' : '3px solid transparent',
    borderRadius: '6px',
    transition: 'background-color 0.16s ease, border-left-color 0.16s ease',
    color: darkMode ? '#e2e8f0' : '#0f172a'
  });

  const headerControlStyle = (hoverKey) => ({
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    color: '#fff',
    backgroundColor: darkMode
      ? (headerHoverItem === hoverKey ? 'rgba(148,163,184,0.30)' : 'rgba(148,163,184,0.14)')
      : (headerHoverItem === hoverKey ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.14)'),
    transform: headerHoverItem === hoverKey ? 'translateY(-1px)' : 'translateY(0)',
    transition: 'all 0.18s ease'
  });

  const dropdownPanelStyle = (width, zIndex) => ({
    width,
    zIndex,
    background: darkMode ? '#1e2540' : '#fff',
    borderColor: darkMode ? 'rgba(148,163,184,0.26)' : '#dee2e6',
    top: '100%'
  });

  return (
    <div className={`d-flex flex-column min-vh-100${darkMode ? ' dark-mode' : ''}`} style={{ background: darkMode ? '#141824' : '#f1f5f9' }}>
      {/* TOP HEADER (Matches SVG) */}
      <div
        className="px-2 px-sm-3 px-lg-4 py-2 d-flex justify-content-between align-items-center shadow-sm flex-shrink-0"
        style={{
          minHeight: '56px',
          background: darkMode ? '#1b2238' : 'linear-gradient(90deg, #125a9b 0%, #1f6fd0 100%)',
          borderBottom: darkMode ? '1px solid rgba(148,163,184,0.24)' : '1px solid rgba(255,255,255,0.26)',
          color: '#ffffff'
        }}
      >
        <div className="d-flex align-items-center gap-2 flex-grow-1 overflow-hidden">
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              style={{
                borderColor: darkMode
                  ? (headerHoverItem === 'menu' ? 'rgba(148,163,184,0.65)' : 'rgba(148,163,184,0.34)')
                  : (headerHoverItem === 'menu' ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.45)'),
                color: '#ffffff',
                backgroundColor: darkMode
                  ? (headerHoverItem === 'menu' ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.08)')
                  : (headerHoverItem === 'menu' ? 'rgba(255,255,255,0.20)' : 'transparent'),
                transform: headerHoverItem === 'menu' ? 'translateY(-1px)' : 'translateY(0)',
                transition: 'all 0.18s ease'
              }}
              onClick={() => setMenuOpen((open) => !open)}
              onMouseEnter={() => setHeaderHoverItem('menu')}
              onMouseLeave={() => setHeaderHoverItem('')}
              title="Open menu"
              aria-expanded={menuOpen}
            >
              ☰
            </button>
            <span className="fw-bold fs-6 fs-lg-5 text-truncate">
              {isMobileView ? 'Road Hazard Admin' : 'Road Hazard Management System'}
            </span>
        </div>
        <div className="d-flex align-items-center gap-1 gap-sm-2 ms-2 flex-shrink-0">
            {/* Notification dropdown */}
            <div className="position-relative" ref={notificationDropdownRef}>
              <button
                type="button"
                className="btn btn-sm btn-outline-light position-relative"
                style={headerControlStyle('notification')}
                onClick={() => {
                  setProfileOpen(false);
                  setNotificationOpen((open) => !open);
                }}
                onMouseEnter={() => setHeaderHoverItem('notification')}
                onMouseLeave={() => setHeaderHoverItem('')}
                aria-expanded={notificationOpen}
                title="Notifications"
              >
                <span className="d-inline-flex align-items-center" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 14.2C8.828 14.2 9.5 13.528 9.5 12.7H6.5C6.5 13.528 7.172 14.2 8 14.2Z" fill="currentColor"/>
                    <path d="M8 2.1C6.233 2.1 4.8 3.533 4.8 5.3V6.86C4.8 7.55 4.56 8.218 4.12 8.75L3.03 10.07C2.743 10.418 2.991 10.95 3.442 10.95H12.558C13.009 10.95 13.257 10.418 12.97 10.07L11.88 8.75C11.44 8.218 11.2 7.55 11.2 6.86V5.3C11.2 3.533 9.767 2.1 8 2.1Z" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                </span>
                {unreadRepairNotificationCount > 0 && (
                  <span
                    className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
                    style={{ fontSize: '0.62rem' }}
                  >
                    {unreadRepairNotificationCount > 99 ? '99+' : unreadRepairNotificationCount}
                  </span>
                )}
              </button>

              {notificationOpen && (
                <div
                  className="position-absolute end-0 mt-1 shadow-lg rounded-3 border"
                  style={dropdownPanelStyle(isMobileView ? 'min(92vw, 340px)' : '340px', 2100)}
                >
                  <div className="px-3 py-2 d-flex justify-content-between align-items-center" style={{ borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : '#f0f0f0'}` }}>
                    <strong style={{ fontSize: '0.9rem', color: darkMode ? '#e2e8f0' : '#212529' }}>Notifications</strong>
                    <div className="d-flex align-items-center gap-2">
                      <span className="badge bg-secondary">{repairNotifications.length}</span>
                      {unreadRepairNotificationCount > 0 && <span className="badge bg-danger">{unreadRepairNotificationCount} new</span>}
                    </div>
                  </div>

                  <div className="px-2 py-2" style={{ maxHeight: '360px', overflowY: 'auto' }}>
                    {repairNotifications.length === 0 && (
                      <div className="small text-muted px-1">No notifications yet.</div>
                    )}
                    {repairNotifications.length > 0 && unreadRepairNotificationCount > 0 && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary w-100 mb-2"
                        onClick={markAllRepairNotificationsRead}
                      >
                        Mark all as read
                      </button>
                    )}
                    {repairNotifications.map((item) => {
                      const isUnread = !seenRepairEventIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`btn btn-sm w-100 text-start mb-1 border ${isUnread ? 'btn-warning-subtle border-warning' : 'btn-light'}`}
                          onClick={() => openNotificationReport(item)}
                          title={`Open report ${item.recordId}`}
                        >
                          <div className="fw-semibold d-flex justify-content-between align-items-center" style={{ fontSize: '0.78rem' }}>
                            <span>{String(item.action || 'updated').replace(/_/g, ' ')} • #{String(item.recordId || '').slice(0, 6)}</span>
                            {isUnread && <span className="badge bg-danger">NEW</span>}
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                            {item.actor || 'system'} • {formatTimeAgo(item.at)}
                          </div>
                          {item.note && <div style={{ fontSize: '0.72rem' }} className="text-muted">{item.note}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Profile dropdown */}
            <div className="position-relative" ref={profileDropdownRef}>
              <button
                type="button"
                className="btn btn-sm btn-outline-light d-flex align-items-center gap-2 px-2 py-1"
                style={headerControlStyle('profile')}
                onClick={() => {
                  setNotificationOpen(false);
                  setProfileOpen(o => !o);
                }}
                onMouseEnter={() => setHeaderHoverItem('profile')}
                onMouseLeave={() => setHeaderHoverItem('')}
                aria-expanded={profileOpen}
                title="Profile & settings"
              >
                <div
                  className="rounded-circle fw-bold d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: '32px',
                    height: '32px',
                    fontSize: '0.75rem',
                    backgroundColor: darkMode ? 'rgba(148,163,184,0.24)' : 'rgba(255,255,255,0.2)',
                    color: '#ffffff'
                  }}
                >
                  {adminInitials}
                </div>
                <div className="text-end lh-1 d-none d-sm-block">
                  <div className="fw-semibold" style={{fontSize: '0.85rem'}}>{adminDisplayName}</div>
                  <div className="opacity-75" style={{fontSize: '0.7rem'}}>Admin</div>
                </div>
                <span style={{fontSize: '0.65rem', opacity: 0.8}}>▼</span>
              </button>

              {/* Dropdown panel */}
              {profileOpen && (
                <div
                  className="position-absolute end-0 mt-1 shadow-lg rounded-3 border"
                  style={dropdownPanelStyle(isMobileView ? 'min(86vw, 260px)' : '220px', 2000)}
                >
                  {/* Profile info block */}
                  <div className="px-3 py-3" style={{borderBottom: `1px solid ${darkMode ? 'rgba(148,163,184,0.22)' : '#f0f0f0'}`}}>
                    <div className="d-flex align-items-center gap-2">
                      <div className="bg-primary rounded-circle text-white fw-bold d-flex align-items-center justify-content-center flex-shrink-0" style={{width: '38px', height: '38px'}}>{adminInitials}</div>
                      <div>
                        <div className="fw-semibold" style={{fontSize: '0.9rem', color: darkMode ? '#e2e8f0' : '#212529'}}>{adminDisplayName}</div>
                        <div style={{fontSize: '0.72rem', color: darkMode ? '#94a3b8' : '#6c757d'}}>{adminEmail || 'Administrator'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Dark mode toggle */}
                  <div
                    className="px-3 py-2 d-flex align-items-center justify-content-between"
                    style={{borderBottom: `1px solid ${darkMode ? 'rgba(148,163,184,0.22)' : '#f0f0f0'}`, cursor: 'pointer'}}
                    onClick={() => setDarkMode(d => !d)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setDarkMode(d => !d)}
                  >
                    <span style={{fontSize: '0.875rem', color: darkMode ? '#e2e8f0' : '#212529'}}>
                      {darkMode ? 'Light Mode' : 'Dark Mode'}
                    </span>
                    <div
                      className="flex-shrink-0"
                      style={{
                        width: '38px', height: '20px', borderRadius: '10px',
                        background: darkMode ? '#3b82f6' : '#dee2e6',
                        position: 'relative', transition: 'background 0.2s'
                      }}
                    >
                      <div style={{
                        position: 'absolute', top: '2px',
                        left: darkMode ? '20px' : '2px',
                        width: '16px', height: '16px',
                        borderRadius: '50%', background: '#fff',
                        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                      }} />
                    </div>
                  </div>

                  {/* Logout */}
                  <div className="px-3 py-2">
                    <button
                      type="button"
                      className="btn btn-sm w-100 text-start"
                      style={{
                        color: '#ef4444', background: 'none', border: 'none',
                        fontSize: '0.875rem', padding: '0.25rem 0'
                      }}
                      onClick={() => { setProfileOpen(false); (onLogout ? onLogout() : setView('login')); }}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
        </div>
      </div>

      <div
        className="position-fixed top-0 start-0 w-100 h-100"
        style={{
          zIndex: 1250,
          pointerEvents: menuOpen ? 'auto' : 'none'
        }}
      >
        <div
          className="position-absolute top-0 start-0 w-100 h-100"
          onClick={() => setMenuOpen(false)}
          style={{
            backgroundColor: 'rgba(15,23,42,0.34)',
            opacity: menuOpen ? 1 : 0,
            transition: 'opacity 0.22s ease'
          }}
        />
        <div
          className="position-absolute top-0 start-0 h-100 shadow border-end"
          style={{
            width: '280px',
            transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.24s ease',
            willChange: 'transform',
            backgroundColor: darkMode ? '#1e2540' : '#ffffff',
            borderColor: darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0'
          }}
        >
          <div className="d-flex justify-content-between align-items-center px-3 py-3 border-bottom" style={{ borderBottomColor: darkMode ? 'rgba(148,163,184,0.24)' : '#e2e8f0' }}>
            <strong style={{ color: darkMode ? '#e2e8f0' : '#0f172a' }}>Navigation</strong>
            <button type="button" className="btn btn-sm btn-light" onClick={() => setMenuOpen(false)}>Close</button>
          </div>
          <div className="p-2">
            {sideMenuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className="btn btn-sm w-100 text-start px-3 py-2 border-0"
                style={sideMenuItemStyle(item.key)}
                onMouseEnter={() => setMenuHoverItem(item.key)}
                onMouseLeave={() => setMenuHoverItem('')}
                onClick={() => {
                  setDashboardPage(item.key);
                  setMenuHoverItem('');
                  setMenuOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {dashboardPage === 'overview' ? (
        <LandingPage
          darkMode={darkMode}
          adminDisplayName={adminDisplayName}
          stats={stats}
          overview={dashboardOverview}
          onOpenManagement={() => setDashboardPage('management')}
          onOpenPending={() => {
            setDashboardPage('management');
            setActiveTab('Pending');
          }}
          onOpenRetrain={() => {
            setDashboardPage('management');
          }}
          onOpenContractors={() => setDashboardPage('contractors')}
          onSelectReport={(recordId) => {
            const matched = allReports.find((report) => report.recordId === recordId);
            if (matched) {
              setDashboardPage('management');
              setSelectedReport(matched);
            }
          }}
          formatLocationText={formatLocationText}
          formatTimeAgo={formatTimeAgo}
          formatHazardLabel={formatHazardLabel}
        />
      ) : dashboardPage === 'augmentation' ? (
        <AugmentationPage {...augmentationProps} />
      ) : dashboardPage === 'contractors' ? (
        <ContractorsPage
          API_URL={API_URL}
          onOpenReport={handleOpenReportFromContractors}
          onDirectoryChanged={fetchContractorDirectory}
          darkMode={darkMode}
          isMobileView={isMobileView}
        />
      ) : (
        <ManagementPage {...managementProps} isMobileView={isMobileView} />
      )}

      {contractorPicker.open && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 2120 }}>
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)', opacity: contractorPicker.visible ? 1 : 0, transition: 'opacity 0.2s ease' }}
            onClick={() => {
              if (!contractorPicker.submitting) closeContractorPicker();
            }}
          />
          <div
            className="position-relative rounded-3 shadow-lg border p-3"
            style={{
              width: 'min(94vw, 560px)',
              backgroundColor: darkMode ? '#1e2540' : '#ffffff',
              borderColor: darkMode ? 'rgba(255,255,255,0.12)' : '#dee2e6',
              opacity: contractorPicker.visible ? 1 : 0,
              transform: contractorPicker.visible ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 0.2s ease, transform 0.2s ease'
            }}
          >
            <div className="fw-semibold mb-1" style={{ color: darkMode ? '#e2e8f0' : '#212529' }}>
              Select Contractor Organization
            </div>
            <div className="small mb-3" style={{ color: darkMode ? '#cbd5e1' : '#6c757d' }}>
              Pick one of your registered contractors for this repair request.
            </div>

            <select
              className="form-select"
              value={contractorPicker.selectedId}
              onChange={(event) => setContractorPicker((current) => ({ ...current, selectedId: event.target.value }))}
              disabled={contractorPicker.submitting}
            >
              {contractorDirectory.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.email || 'No email'})
                </option>
              ))}
            </select>

            {(() => {
              const selectedOrg = contractorDirectory.find((org) => org.id === contractorPicker.selectedId) || null;
              if (!selectedOrg) return null;
              return (
                <div className="mt-3 rounded-3 border p-3" style={{ backgroundColor: darkMode ? '#162033' : '#f8f9fa', borderColor: darkMode ? 'rgba(255,255,255,0.12)' : '#dee2e6' }}>
                  <div className="fw-semibold" style={{ color: darkMode ? '#f8fafc' : '#212529' }}>{selectedOrg.name}</div>
                  <div className="small" style={{ color: darkMode ? '#cbd5e1' : '#495057' }}>{selectedOrg.type || 'Contractor organization'} • {selectedOrg.coverage || 'Coverage not set'}</div>
                  <div className="small mt-2" style={{ color: darkMode ? '#e2e8f0' : '#495057' }}>Email: {selectedOrg.email || 'N/A'}</div>
                  <div className="small" style={{ color: darkMode ? '#e2e8f0' : '#495057' }}>Phone: {selectedOrg.phone || 'N/A'}</div>
                  <div className="small" style={{ color: darkMode ? '#e2e8f0' : '#495057' }}>Contact: {selectedOrg.contactPerson || 'Operations Desk'}</div>
                </div>
              );
            })()}

            <div className="d-flex justify-content-end gap-2 mt-3">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={contractorPicker.submitting}
                onClick={closeContractorPicker}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={contractorPicker.submitting || !contractorPicker.selectedId}
                onClick={submitRepairRequest}
              >
                {contractorPicker.submitting ? 'Sending...' : 'Send Repair Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {statusConfirm.open && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 2100 }}>
          <div
            className="position-absolute top-0 start-0 w-100 h-100"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)', opacity: statusConfirm.visible ? 1 : 0, transition: 'opacity 0.2s ease' }}
            onClick={closeStatusConfirm}
          />
          <div
            className="position-relative rounded-3 shadow-lg border p-3"
            style={{
              width: 'min(92vw, 420px)',
              backgroundColor: darkMode ? '#1e2540' : '#fff',
              borderColor: darkMode ? 'rgba(255,255,255,0.12)' : '#dee2e6',
              opacity: statusConfirm.visible ? 1 : 0,
              transform: statusConfirm.visible ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.2s ease, transform 0.2s ease'
            }}
          >
            <div className="fw-semibold mb-2" style={{ color: darkMode ? '#e2e8f0' : '#212529' }}>Confirm status update</div>
            <div className="mb-3" style={{ color: darkMode ? '#cbd5e1' : '#495057' }}>
              Mark this report as <strong>{statusConfirm.newStatus}</strong>?
            </div>
            {statusConfirm.newStatus === 'Rejected' && (
              <div className="mb-3">
                <label className="form-label small fw-semibold" style={{ color: darkMode ? '#cbd5e1' : '#495057' }}>
                  Rejection reason <span className="text-muted fw-normal">(will be emailed to reporter if they provided an email)</span>
                </label>
                <textarea
                  className="form-control form-control-sm"
                  rows={3}
                  placeholder="e.g. Image is unclear, no hazard detected, duplicate report..."
                  value={statusConfirm.rejectionNote || ''}
                  onChange={(e) => setStatusConfirm((prev) => ({ ...prev, rejectionNote: e.target.value }))}
                  style={{ backgroundColor: darkMode ? '#2d3748' : '#fff', color: darkMode ? '#e2e8f0' : '#212529', borderColor: darkMode ? 'rgba(255,255,255,0.15)' : '#ced4da' }}
                />
              </div>
            )}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={closeStatusConfirm}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-sm ${statusConfirm.newStatus === 'Rejected' ? 'btn-danger' : 'btn-primary'}`}
                onClick={async () => {
                  const { id, newStatus, rejectionNote } = statusConfirm;
                  closeStatusConfirm();
                  if (id && newStatus) await submitStatusUpdate(id, newStatus, rejectionNote);
                }}
              >
                {statusConfirm.newStatus === 'Rejected' ? 'Confirm Rejection' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.open && (
        <div className="position-fixed end-0 bottom-0 p-2 p-sm-3" style={{ zIndex: 2150 }}>
          <div
            className={`toast show align-items-center border-0 shadow-lg ${toast.type === 'error' ? 'bg-danger text-white' : toast.type === 'warning' ? 'bg-warning text-dark' : toast.type === 'success' ? 'bg-success text-white' : 'bg-primary text-white'}`}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{
              width: isMobileView ? 'min(92vw, 420px)' : 'auto',
              minWidth: isMobileView ? '0' : '320px',
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
    </div>
  );
};

export default Dashboard;
