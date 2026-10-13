export const drawAugmentedToCanvas = (canvas, image, effectOptions) => {
  if (!canvas || !image) return;

  const maxWidth = 640;
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const intensity = Math.max(0, Math.min(1, Number(effectOptions?.intensity ?? 0.7)));
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  if (effectOptions?.sunGlare) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const sunX = width * 0.22;
    const sunY = height * 0.18;
    const radius = Math.max(width, height) * (0.45 + intensity * 0.25);
    const radial = ctx.createRadialGradient(sunX, sunY, 12, sunX, sunY, radius);
    radial.addColorStop(0, `rgba(255,255,240,${0.45 + intensity * 0.35})`);
    radial.addColorStop(0.45, `rgba(255,255,220,${0.18 + intensity * 0.18})`);
    radial.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (effectOptions?.shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.16 + intensity * 0.22})`;
    const polygonCount = 2 + Math.round(intensity * 2);
    for (let index = 0; index < polygonCount; index += 1) {
      const cx = width * (0.25 + ((index * 0.31) % 0.55));
      const cy = height * (0.18 + ((index * 0.27) % 0.62));
      const radius = Math.min(width, height) * (0.18 + intensity * 0.1);
      ctx.beginPath();
      for (let step = 0; step < 7; step += 1) {
        const angle = ((Math.PI * 2) / 7) * step + (index * 0.37);
        const localRadius = radius * (0.65 + ((step % 3) * 0.12));
        const px = cx + Math.cos(angle) * localRadius;
        const py = cy + Math.sin(angle) * localRadius;
        if (step === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.08 + intensity * 0.1})`;
    for (let strip = 0; strip < 12; strip += 1) {
      const y = ((strip * 77) % height) - 30;
      ctx.fillRect(0, y, width, 18 + ((strip % 4) * 4));
    }
    ctx.restore();
  }

  if (effectOptions?.rain) {
    ctx.save();
    ctx.fillStyle = `rgba(175,185,195,${0.05 + intensity * 0.1})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const paintRainLayer = (count, alpha, widthScale, speedScale) => {
      ctx.save();
      ctx.strokeStyle = `rgba(230,238,246,${alpha})`;
      ctx.lineWidth = widthScale;
      for (let streak = 0; streak < count; streak += 1) {
        const startX = ((streak * 47) + (streak % 11) * 13) % width;
        const startY = ((streak * 89) + (streak % 7) * 9) % height;
        const length = 9 + ((streak * 17) % 18) * speedScale;
        const dx = 5 + intensity * 6;
        const dy = length;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + dx, startY + dy);
        ctx.stroke();
      }
      ctx.restore();
    };

    paintRainLayer(Math.round(95 + intensity * 175), 0.2 + intensity * 0.12, 1.0, 0.75);
    paintRainLayer(Math.round(70 + intensity * 130), 0.26 + intensity * 0.14, 1.45, 1.05);

    ctx.save();
    ctx.strokeStyle = `rgba(240,246,252,${0.26 + intensity * 0.2})`;
    ctx.lineWidth = 2;
    for (let streak = 0; streak < Math.round(14 + intensity * 24); streak += 1) {
      const startX = ((streak * 59) + 23) % width;
      const startY = ((streak * 73) + 41) % height;
      const length = 18 + ((streak * 11) % 20);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + (8 + intensity * 6), startY + length);
      ctx.stroke();
    }
    ctx.restore();

    const temp = document.createElement('canvas');
    temp.width = width;
    temp.height = height;
    const blurCtx = temp.getContext('2d');
    if (blurCtx) {
      blurCtx.filter = `blur(${1.2 + intensity * 1.1}px)`;
      blurCtx.drawImage(canvas, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(temp, 0, 0);
    }

    ctx.save();
    const mist = ctx.createLinearGradient(0, 0, 0, height);
    mist.addColorStop(0, `rgba(220,228,235,${0.07 + intensity * 0.1})`);
    mist.addColorStop(1, `rgba(200,210,220,${0.12 + intensity * 0.12})`);
    ctx.fillStyle = mist;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(245,250,255,${0.05 + intensity * 0.07})`;
    for (let drop = 0; drop < Math.round(20 + intensity * 20); drop += 1) {
      const x = ((drop * 113) + 19) % width;
      const y = ((drop * 79) + 31) % height;
      const r = 2 + (drop % 3);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (effectOptions?.wetSurface) {
    ctx.save();
    const wetGradient = ctx.createLinearGradient(0, height * 0.35, 0, height);
    wetGradient.addColorStop(0, 'rgba(120,150,180,0)');
    wetGradient.addColorStop(1, `rgba(90,125,160,${0.2 + intensity * 0.26})`);
    ctx.fillStyle = wetGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(210,225,235,${0.26 + intensity * 0.24})`;
    ctx.lineWidth = 1;
    for (let row = 0; row < 24; row += 1) {
      const y = height * (0.52 + (row / 70));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + ((row % 3) - 1));
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    const puddleCount = Math.round(6 + intensity * 10);
    for (let puddle = 0; puddle < puddleCount; puddle += 1) {
      const cx = ((puddle * 137) + 47) % width;
      const cy = height * (0.56 + ((puddle * 23) % 34) / 100);
      const rx = Math.max(16, width * (0.05 + ((puddle % 4) * 0.015)));
      const ry = Math.max(7, height * (0.012 + ((puddle % 3) * 0.005)));
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210,225,240,${0.06 + intensity * 0.1})`;
      ctx.fill();
    }

    const horizonY = height * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(width, horizonY + 2);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.clip();

    ctx.globalAlpha = 0.18 + intensity * 0.2;
    ctx.scale(1, -1);
    ctx.drawImage(canvas, 0, -height * 2, width, height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.restore();
  }

  if (effectOptions?.fog) {
    ctx.save();
    const fogGradient = ctx.createLinearGradient(0, 0, 0, height);
    fogGradient.addColorStop(0, `rgba(250,250,250,${0.18 + intensity * 0.24})`);
    fogGradient.addColorStop(1, `rgba(235,235,235,${0.3 + intensity * 0.26})`);
    ctx.fillStyle = fogGradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (effectOptions?.lowLight) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.22 + intensity * 0.3})`;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = `rgba(255,255,255,${0.02 + intensity * 0.05})`;
    const noiseCount = Math.round(1200 + intensity * 2200);
    for (let noiseIndex = 0; noiseIndex < noiseCount; noiseIndex += 1) {
      const px = (noiseIndex * 53) % width;
      const py = (noiseIndex * 97) % height;
      const size = noiseIndex % 4 === 0 ? 2 : 1;
      ctx.fillRect(px, py, size, size);
    }
    ctx.restore();
  }
};

export const normalizeHazardClass = (hazardClass = '') => {
  const normalized = hazardClass.toString().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'transverse_crack' || normalized === 'transversal_crack') return 'not_hazard';
  if (normalized === 'other' || normalized === 'others') return 'crack';
  return normalized;
};

export const hazardColor = (hazardClass = '') => {
  const normalized = normalizeHazardClass(hazardClass);
  if (normalized === 'pothole') return '#ff9800';
  if (normalized === 'alligator_crack') return '#00acc1';
  if (normalized === 'longitudinal_crack') return '#42a5f5';
  if (normalized === 'crack') return '#03a9f4';
  return '#6c757d';
};

export const formatHazardLabel = (hazardClass = '') => {
  if (!hazardClass) return 'Unknown';
  return normalizeHazardClass(hazardClass)
    .toString()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const getHazardBadgeClass = (hazardClass = '') => {
  const normalized = normalizeHazardClass(hazardClass);
  if (normalized === 'pothole') return 'bg-warning text-dark';
  if (normalized === 'alligator_crack') return 'bg-info';
  if (normalized === 'longitudinal_crack') return 'bg-primary';
  if (normalized === 'crack') return 'bg-info';
  return 'bg-secondary';
};

export const MANUAL_HAZARD_OPTIONS = [
  'pothole',
  'alligator_crack',
  'longitudinal_crack',
  'crack',
  'not_hazard'
];

export const clamp01 = (value) => Math.max(Math.min(value ?? 0, 1), 0);

export const formatTimeAgo = (timestamp) => {
  if (!timestamp) return 'Unknown time';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < -60) return `In ${Math.ceil(Math.abs(seconds) / 60)}m`;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export const formatCoordinates = (location) => {
  const lat = location?.latitude;
  const lng = location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return 'Unknown coordinates';
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
};

export const formatLocationText = (report) => {
  const address = report?.location?.address?.trim();
  if (address) return address;
  return formatCoordinates(report?.location);
};

export const MALAYSIA_STATES = [
  'Perlis',
  'Kedah',
  'Pulau Pinang',
  'Penang',
  'Perak',
  'Selangor',
  'Negeri Sembilan',
  'Melaka',
  'Johor',
  'Pahang',
  'Terengganu',
  'Kelantan',
  'Sabah',
  'Sarawak',
  'Kuala Lumpur',
  'Putrajaya',
  'Labuan'
];

const LOCATION_STATE_CANONICAL = {
  'pulau pinang': 'Penang',
  penang: 'Penang'
};

const canonicalizeStateLabel = (stateLabel = '') => {
  const normalized = String(stateLabel || '').trim().toLowerCase();
  if (!normalized) return '';
  return LOCATION_STATE_CANONICAL[normalized] || stateLabel;
};

export const getLocationFilterLabel = (report) => {
  const address = report?.location?.address?.trim();
  if (!address) return 'Other';

  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'Other';

  const matchedState = [...parts]
    .reverse()
    .find((part) => MALAYSIA_STATES.some((state) => state.toLowerCase() === part.toLowerCase()));
  if (matchedState) return canonicalizeStateLabel(matchedState);
  return 'Other';
};

export const normalizeStatus = (status) => {
  const normalized = (status || '').toString().trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'pending' || normalized === 'pending verification') return 'Pending';
  if (normalized === 'verified') return 'Verified';
  if (normalized === 'requested' || normalized === 'repair requested') return 'Requested';
  if (normalized === 'in progress' || normalized === 'in_progress') return 'In Progress';
  if (normalized === 'completed' || normalized === 'complete') return 'Completed';
  if (normalized === 'rejected' || normalized === 'reject') return 'Rejected';
  return 'Pending';
};

export const normalizeBbox = (bbox) => {
  if (!bbox) return null;

  const maybeX = Number(bbox.x);
  const maybeY = Number(bbox.y);
  const maybeW = Number(bbox.width);
  const maybeH = Number(bbox.height);

  if ([maybeX, maybeY, maybeW, maybeH].every(Number.isFinite)) {
    if (maybeX > 1 || maybeY > 1 || maybeW > 1 || maybeH > 1) {
      return null;
    }
    return {
      x: clamp01(maybeX),
      y: clamp01(maybeY),
      width: clamp01(maybeW),
      height: clamp01(maybeH)
    };
  }

  const x1 = Number(bbox.x1);
  const y1 = Number(bbox.y1);
  const x2 = Number(bbox.x2);
  const y2 = Number(bbox.y2);
  if ([x1, y1, x2, y2].every(Number.isFinite)) {
    if (x1 > 1 || y1 > 1 || x2 > 1 || y2 > 1) {
      return null;
    }
    const left = clamp01(Math.min(x1, x2));
    const top = clamp01(Math.min(y1, y2));
    const right = clamp01(Math.max(x1, x2));
    const bottom = clamp01(Math.max(y1, y2));
    return {
      x: left,
      y: top,
      width: clamp01(right - left),
      height: clamp01(bottom - top)
    };
  }

  return null;
};

export const sameNormalizedBbox = (left, right, epsilon = 0.0015) => {
  const a = normalizeBbox(left);
  const b = normalizeBbox(right);
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.width - b.width) <= epsilon
    && Math.abs(a.height - b.height) <= epsilon;
};
