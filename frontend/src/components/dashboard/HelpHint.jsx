import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HelpHint = ({ text, darkMode = false, accentColor }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, side: 'right' });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const tooltipWidth = 280;
      const gap = 0;
      const viewportPadding = 12;
      let side = 'right';
      let left = rect.right + gap;

      if (left + tooltipWidth > window.innerWidth - viewportPadding) {
        side = 'left';
        left = Math.max(viewportPadding, rect.left - tooltipWidth - gap);
      }

      const top = Math.min(
        window.innerHeight - viewportPadding,
        Math.max(viewportPadding, rect.top + rect.height / 2)
      );

      setPosition({ top, left, side });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleOutsideClick = (event) => {
      const target = event.target;
      if (triggerRef.current?.contains(target)) return;
      if (tooltipRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const hintFg = accentColor || (darkMode ? '#93c5fd' : '#1d4ed8');
  const hintBg = accentColor
    ? (darkMode ? `${accentColor}22` : `${accentColor}1f`)
    : (darkMode ? 'rgba(96,165,250,0.2)' : '#dbeafe');
  const hintBorder = accentColor
    ? (darkMode ? `${accentColor}66` : `${accentColor}88`)
    : (darkMode ? 'rgba(96,165,250,0.4)' : '#93c5fd');

  return (
    <span
      ref={triggerRef}
      className="d-inline-flex align-items-center justify-content-center"
      style={{ width: '18px', height: '18px', zIndex: 5 }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen((prev) => !prev);
      }}
      aria-label={text}
      tabIndex={0}
      role="button"
    >
      <span
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '999px',
          fontSize: '11px',
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: hintBg,
          color: hintFg,
          border: `1px solid ${hintBorder}`,
          cursor: 'pointer'
        }}
      >
        !
      </span>
      {isOpen && createPortal(
        <div
          ref={tooltipRef}
          className="rounded-2 p-3"
          style={{
            position: 'fixed',
            left: `${position.left}px`,
            top: `${position.top}px`,
            transform: 'translateY(-50%)',
            background: darkMode ? '#0f172a' : '#1e293b',
            color: '#fff',
            fontSize: '0.8rem',
            lineHeight: '1.5',
            width: 'min(280px, calc(100vw - 24px))',
            zIndex: 9999,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            whiteSpace: 'normal',
            border: `1px solid ${darkMode ? 'rgba(148,163,184,0.3)' : 'rgba(255,255,255,0.15)'}`,
            pointerEvents: 'auto'
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {text}
          <div
            style={{
              position: 'absolute',
              left: position.side === 'right' ? '-6px' : 'auto',
              right: position.side === 'left' ? '-6px' : 'auto',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 0,
              height: 0,
              borderRight: position.side === 'right' ? `6px solid ${darkMode ? '#0f172a' : '#1e293b'}` : 'none',
              borderLeft: position.side === 'left' ? `6px solid ${darkMode ? '#0f172a' : '#1e293b'}` : 'none',
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent'
            }}
          />
        </div>,
        document.body
      )}
    </span>
  );
};

export default HelpHint;
