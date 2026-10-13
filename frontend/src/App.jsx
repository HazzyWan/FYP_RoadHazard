import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Home from './components/Home';
import Report from './components/Report';
import MySubmissions from './components/MySubmissions';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import PartnerPortal from './components/PartnerPortal';
import LoadingText from './components/common/LoadingText';
import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';

// API base URL resolution:
// 1) Use VITE_API_URL if provided (set during build or via env)
// 2) For hosted domains, prefer same-origin /api via Firebase rewrite
// 3) For local/phone access, derive from current hostname with port 5000
const derivedApi = (() => {
  if (typeof window === 'undefined') return null;
  const { protocol, hostname } = window.location;
  
  // Production Firebase Hosting: keep API same-origin so session cookies remain first-party.
  if (hostname === 'roadhazard-fyp.web.app' || hostname === 'roadhazard-fyp.firebaseapp.com') {
    return (import.meta.env.VITE_HOSTED_API_URL || '/api').trim() || '/api';
  }
  
  // Local/phone access: uses actual host from current connection
  return `${protocol}//${hostname}:5000/api`;
})();
const API_URL = import.meta.env.VITE_API_URL || derivedApi;
const VIEW_STORAGE_KEY = 'roadhazard_view';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Preserve stack in browser console for debugging while preventing blank screen.
    console.error('Dashboard render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="d-flex flex-column align-items-center justify-content-center min-vh-100 px-3" style={{ backgroundColor: '#f1f5f9', color: '#0f172a' }}>
          <div className="text-center" style={{ maxWidth: '560px' }}>
            <h4 className="fw-bold mb-2">Something went wrong while loading the page.</h4>
            <p className="text-muted mb-3">Please refresh the page. If this keeps happening, log in again.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const partnerPortalToken = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const pathname = window.location.pathname || '';
    const partnerPrefix = '/repair/partner/';
    if (!pathname.startsWith(partnerPrefix)) return '';
    return decodeURIComponent(pathname.slice(partnerPrefix.length).split('/')[0] || '').trim();
  }, []);

  const initialView = useMemo(() => {
    if (partnerPortalToken) return 'partner-portal';
    if (typeof window === 'undefined') return 'home';
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored || 'home';
  }, [partnerPortalToken]);

  const [view, setViewState] = useState(initialView);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [adminUser, setAdminUser] = useState(null);

  useEffect(() => {
    axios.defaults.withCredentials = true;
  }, []);

  const setView = (nextView, options = {}) => {
    const skipAuthGuard = Boolean(options?.skipAuthGuard);
    const target = nextView === 'dashboard' && !isAdminAuthenticated && !skipAuthGuard ? 'login' : nextView;
    setViewState(target);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIEW_STORAGE_KEY, target);
    }
  };

  useEffect(() => {
    if (partnerPortalToken) {
      setAuthChecked(true);
      return;
    }

    let mounted = true;

    const checkAuth = async () => {
      try {
        const response = await axios.get(`${API_URL}/auth/me`, { withCredentials: true, timeout: 8000 });
        const authenticated = Boolean(response?.data?.authenticated);
        if (!mounted) return;
        setIsAdminAuthenticated(authenticated);
        if (authenticated) {
          setAdminUser(response.data.admin || null);
        }

        if (view === 'dashboard' && !authenticated) {
          setViewState('login');
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(VIEW_STORAGE_KEY, 'login');
          }
        }
      } catch {
        if (!mounted) return;
        setIsAdminAuthenticated(false);
        if (view === 'dashboard') {
          setViewState('login');
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(VIEW_STORAGE_KEY, 'login');
          }
        }
      } finally {
        if (mounted) setAuthChecked(true);
      }
    };

    checkAuth();
    return () => {
      mounted = false;
    };
  }, [API_URL, partnerPortalToken]);

  const handleLoginSuccess = (user) => {
    setIsAdminAuthenticated(true);
    if (user) setAdminUser(user);
    setView('dashboard', { skipAuthGuard: true });
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true, timeout: 8000 });
    } catch {
      // best-effort logout
    }
    setIsAdminAuthenticated(false);
    setAdminUser(null);
    setView('login');
  };

  if (!authChecked && view === 'dashboard') {
    return <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light text-muted"><LoadingText>Checking session</LoadingText></div>;
  }

  const appBackground = view === 'dashboard' ? 'transparent' : '#f8f9fa';

  if (partnerPortalToken) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
        <AppErrorBoundary>
          <PartnerPortal token={partnerPortalToken} API_URL={API_URL} />
        </AppErrorBoundary>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: appBackground }}>
      <AppErrorBoundary>
        {view === 'home' && <Home setView={setView} API_URL={API_URL} />}
        {view === 'report' && <Report setView={setView} API_URL={API_URL} />}
        {view === 'my-submissions' && <MySubmissions setView={setView} API_URL={API_URL} />}
        {view === 'login' && <Login setView={setView} API_URL={API_URL} onLoginSuccess={handleLoginSuccess} />}
        {view === 'dashboard' && isAdminAuthenticated && <Dashboard setView={setView} onLogout={handleLogout} API_URL={API_URL} adminUser={adminUser} />}
      </AppErrorBoundary>
    </div>
  );
}

export default App;