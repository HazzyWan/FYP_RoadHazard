import React from 'react';

const PartnerPortal = ({ token, API_URL }) => {
  if (!token) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger mb-0" role="alert">
          Missing portal token.
        </div>
      </div>
    );
  }

  const portalSrc = `${API_URL}/repair/partner/${encodeURIComponent(token)}`;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#eff4fb' }}>
      <iframe
        title="RoadHazard Partner Portal"
        src={portalSrc}
        style={{
          width: '100%',
          minHeight: '100vh',
          border: 0,
          display: 'block'
        }}
      />
    </div>
  );
};

export default PartnerPortal;
