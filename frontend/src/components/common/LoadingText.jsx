import React from 'react';

const LoadingDots = () => (
  <span className="loading-dots" aria-hidden="true">
    <span className="loading-dot">.</span>
    <span className="loading-dot">.</span>
    <span className="loading-dot">.</span>
  </span>
);

const LoadingText = ({ children, className = '' }) => (
  <span className={`loading-text ${className}`.trim()}>
    <span>{children}</span>
    <LoadingDots />
  </span>
);

export default LoadingText;
