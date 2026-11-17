export const DEFAULTS = {
  capture: {
    mode: 'visible', // visible | area | full | scroll | delayed | element | desktop
    delay: 3,
    fileType: 'png', // png | jpg | pdf
    annotate: true,
    copy: false,
    destination: 'downloads', // downloads | ask | none
    jpgQuality: 0.92,
    hideFixed: true,
  },
  record: {
    source: 'tab', // tab | window | desktop
    mic: false,
    systemAudio: true,
    webcam: false,
    cursor: true,
    countdown: 3, // 0 | 3 | 5 | 10
    quality: '1080', // 720 | 1080 | 1440 | 2160
    fps: 30, // 24 | 30 | 60
    webcamPosition: 'bottom-left',
  },
  ui: { view: 'home' },
};

const merge = (base, over) => {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? { ...base[k], ...over[k] } : over[k];
  }
  return out;
};

// Settings that must be one of a fixed set. Anything else in storage (an older version, a bad write, a hand edit)
// falls back to the default instead of breaking a page, e.g. a non-string fileType stopped the editor from loading.
const CHOICES = {
  capture: {
    mode: ['visible', 'area', 'full', 'scroll', 'delayed', 'element', 'desktop'],
    delay: [3, 5, 10],
    fileType: ['png', 'jpg', 'pdf'],
    destination: ['downloads', 'ask', 'none'],
  },
  record: {
    source: ['tab', 'window', 'desktop'],
    countdown: [0, 3, 5, 10],
    quality: ['720', '1080', '1440', '2160'],
    fps: [24, 30, 60],
    webcamPosition: ['bottom-left', 'bottom-right', 'top-left', 'top-right'],
  },
};
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function validValue(group, key, value) {
  const def = DEFAULTS[group][key];
  const choices = CHOICES[group]?.[key];
  if (choices) return choices.includes(value);
  if (key === 'jpgQuality') return typeof value === 'number' && value > 0 && value <= 1;
  return typeof value === typeof def && (typeof def !== 'number' || Number.isFinite(value));
}

/** Defaults overlaid with every stored value that is valid; unknown keys are kept as they are. */
function sanitize(stored) {
  const out = {};
  for (const [group, defs] of Object.entries(DEFAULTS)) {
    const over = isPlainObject(stored?.[group]) ? stored[group] : {};
    out[group] = { ...defs };
    for (const [k, v] of Object.entries(over)) if (!(k in defs) || validValue(group, k, v)) out[group][k] = v;
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return sanitize(isPlainObject(settings) ? settings : {});
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = merge(cur, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const QUALITY = {
  720: { w: 1280, h: 720, bps: 4_000_000, label: 'HD (720p)' },
  1080: { w: 1920, h: 1080, bps: 8_000_000, label: 'Full HD (1080p)' },
  1440: { w: 2560, h: 1440, bps: 12_000_000, label: 'QHD (1440p)' },
  2160: { w: 3840, h: 2160, bps: 20_000_000, label: '4K (2160p)' },
};
