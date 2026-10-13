import React, { useEffect, useState } from 'react';
import axios from 'axios';
import MapPanel from './MapPanel';

const Home = ({ setView, API_URL }) => {
  const [metrics, setMetrics] = useState({ reports: 0, fixed: 0 });
  const [mapOpen, setMapOpen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 576 : false));

  useEffect(() => {
    let cancelled = false;

    const fetchMetrics = async () => {
      try {
        const summaryResponse = await axios.get(`${API_URL}/reports_summary`, {
          timeout: 10000
        });
        if (cancelled) return;
        const payload = summaryResponse?.data || {};
        const totalReports = Number(payload.totalReports ?? 0);
        const completedReports = Number(payload.completedReports ?? 0);

        if (Number.isFinite(totalReports) && Number.isFinite(completedReports)) {
          setMetrics({ reports: totalReports, fixed: completedReports });
          return;
        }

        const fallbackResponse = await axios.get(`${API_URL}/reports`, {
          params: { limit: 500 },
          timeout: 10000
        });
        if (cancelled) return;
        const reportData = Array.isArray(fallbackResponse.data) ? fallbackResponse.data : [];
        setMetrics({
          reports: reportData.length,
          fixed: reportData.filter((report) => report.status === 'Completed').length
        });
      } catch {
        if (!cancelled) {
          setMetrics({ reports: 0, fixed: 0 });
        }
      }
    };

    fetchMetrics();
    return () => {
      cancelled = true;
    };
  }, [API_URL]);

  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth < 576);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="container py-5">
      <div className="bg-primary text-white p-5 rounded-4 mb-5 text-center shadow-sm">
        <h1 className="fw-bold display-5">Road Hazard Reporter</h1>
        <p className="lead opacity-75">Report • Track • Make Roads Safer</p>
      </div>

      <div className="row g-5 align-items-center">
        <div className="col-lg-6 order-2 order-lg-1">
          <div className="card border-0 shadow-sm h-100 p-4">
              <h2 className="text-primary fw-bold mb-3">Welcome! 👋</h2>
              <p className="lead mb-4">Help make our roads safer by reporting potholes. Verified by AI.</p>
              <button onClick={() => setView('report')} className="btn btn-primary btn-lg w-100 py-4 mb-3 rounded-3 shadow fw-bold">
                  📷 REPORT A HAZARD
              </button>
              <button onClick={() => setView('my-submissions')} className="btn btn-outline-primary w-100 py-3 rounded-3 fw-bold">📋 My Submissions</button>
              <div className="text-center mt-3">
                 <small className="text-muted text-decoration-underline" style={{cursor: 'pointer'}} onClick={() => setView('login')}>Authority Login</small>
              </div>
          </div>
        </div>

        <div className="col-lg-6 order-1 order-lg-2">
          <div className="row g-3 mb-4">
            <div className="col-6"><div className="p-4 rounded-4 border border-success border-2 text-center bg-white"><h2 className="fw-bold text-success mb-0">{metrics.reports}</h2><div>Reports</div></div></div>
            <div className="col-6"><div className="p-4 rounded-4 border border-warning border-2 text-center bg-white"><h2 className="fw-bold text-warning mb-0">{metrics.fixed}</h2><div>Fixed</div></div></div>
          </div>
          <div className="bg-white p-4 rounded-4 shadow-sm border">
            <h5 className="fw-bold mb-3 text-secondary">How It Works</h5>
             <div className="d-flex align-items-center mb-2"><div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{width:30, height:30}}>1</div><div className="ms-3">Take a Photo</div></div>
             <div className="d-flex align-items-center mb-2"><div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{width:30, height:30}}>2</div><div className="ms-3">AI Verifies Hazard</div></div>
             <div className="d-flex align-items-center"><div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{width:30, height:30}}>3</div><div className="ms-3">Sent to Authorities</div></div>
          </div>
        </div>
      </div>

      {/* Floating Map Button */}
      <button
        className="btn btn-primary rounded-circle shadow-lg"
        style={{
          position: 'fixed',
          bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          right: '16px',
          left: 'auto',
          width: '56px',
          height: '56px',
          minWidth: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          fontSize: '22px',
          borderRadius: '50%',
          zIndex: 1900,
          border: 'none',
          cursor: 'pointer',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          touchAction: 'manipulation',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.06)';
          e.currentTarget.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.25)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        }}
        onClick={() => setMapOpen(!mapOpen)}
        title="View hazard map"
      >
        <span aria-hidden="true">🗺️</span>
      </button>

      {/* Map Panel */}
      <MapPanel isOpen={mapOpen} onClose={() => setMapOpen(false)} API_URL={API_URL} isMobileView={isMobileView} />
    </div>
  );
};

export default Home;