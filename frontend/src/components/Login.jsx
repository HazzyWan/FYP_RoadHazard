import React, { useState, useEffect } from 'react';
import axios from 'axios';
import LoadingText from './common/LoadingText';

const BACKGROUND_IMAGES = [
  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80', // City road
  'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80', // Winding road
  '/login-bg-3.jpg', // Hazard warning sign
  '/login-bg-4.jpg'  // Road infrastructure
];

const Login = ({ setView, API_URL, onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentImageIndex((prevIndex) => (prevIndex + 1) % BACKGROUND_IMAGES.length);
    }, 5000); // Change image every 5 seconds

    return () => clearInterval(intervalId);
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_URL}/auth/login`,
        { email: email.trim(), password },
        { withCredentials: true, timeout: 10000 }
      );
      onLoginSuccess?.(res?.data?.admin || null);
    } catch (loginError) {
      const message = loginError?.response?.data?.error
        || (loginError?.request ? `Cannot reach API endpoint (${API_URL}). Make sure backend is running.` : null)
        || 'Login failed. Check your credentials.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleLogin();
    }
  };

  return (
    <div className="container-fluid min-vh-100 p-0 overflow-hidden">
      <div className="row g-0 min-vh-100">
      {/* LEFT PANEL - BRANDING */}
      <div className="col-12 col-lg-5 d-flex flex-column align-items-center justify-content-center text-white p-4 p-lg-5 text-center position-relative"
           style={{
             overflow: 'hidden',
             zIndex: 1
           }}>
        
        {/* Background Slideshow */}
        {BACKGROUND_IMAGES.map((imgUrl, index) => (
          <div
            key={imgUrl}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.7)), url("${imgUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              opacity: index === currentImageIndex ? 1 : 0,
              transition: 'opacity 1.5s ease-in-out',
              zIndex: -1
            }}
          />
        ))}

        <div className="bg-white bg-opacity-25 rounded-circle d-flex align-items-center justify-content-center mb-4" style={{width: '120px', height: '120px'}}>
            <span style={{fontSize: '4rem'}}>🛣️</span>
        </div>
        <h2 className="fw-bold mb-1" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)' }}>Road Hazard<br/>Management System</h2>
        <div className="mt-4 text-center">
            <p className="mb-0 text-white-50" style={{ fontSize: 'clamp(1rem, 2.8vw, 1.25rem)' }}>AI-Powered Road Infrastructure</p>
            <p className="text-white-50" style={{ fontSize: 'clamp(1rem, 2.8vw, 1.25rem)' }}>Monitoring & Maintenance</p>
        </div>
        <div className="mt-4 text-center small opacity-75">
            <p className="mb-1">Powered by YOLOv8 Deep Learning</p>
            <p>Malaysian Localized Detection</p>
        </div>
      </div>

      {/* RIGHT PANEL - FORM */}
      <div className="col-12 col-lg-7 bg-white d-flex align-items-center justify-content-center p-3 p-sm-4 p-lg-5">
        <div className="w-100" style={{ maxWidth: '450px' }}>
          <div className="card border-0 shadow-lg p-4 p-md-5 rounded-4">
              <div className="text-center mb-4">
                  <h3 className="fw-bold text-dark">Authority Login</h3>
                  <p className="text-muted">Access the management dashboard</p>
              </div>
              
              <div className="mb-3">
                  <label className="fw-bold text-secondary small mb-1">Email Address</label>
                  <input
                    type="email"
                    className="form-control form-control-lg bg-light login-input"
                    placeholder="authority@example.gov.my"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
              </div>
              <div className="mb-4">
                  <label className="fw-bold text-secondary small mb-1">Password</label>
                  <input
                    type="password"
                    className="form-control form-control-lg bg-light login-input"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
              </div>

              {error && (
                <div className="alert alert-danger py-2 small" role="alert">
                  {error}
                </div>
              )}
              
              <div className="small text-muted mb-4">
                Use your authorized admin credentials to access the dashboard.
              </div>

              <button 
                  className="btn btn-primary btn-lg w-100 py-3 fw-bold shadow-sm mb-3"
                  onClick={handleLogin}
                  disabled={loading}
              >
                  {loading ? <LoadingText>Signing in</LoadingText> : '🔐 LOGIN'}
              </button>

              <div className="alert alert-primary d-flex align-items-center p-2 mt-3" role="alert">
                 <small className="mx-auto">🔒 Secure Authentication via Firebase</small>
              </div>

              <div className="text-center mt-3">
                  <button className="btn btn-link text-decoration-none text-muted" onClick={() => setView('home')}>← Back to Public Site</button>
              </div>
          </div>
          <div className="text-center mt-4 text-muted small">
             © 2025 Road Hazard Management System • JKR
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Login;