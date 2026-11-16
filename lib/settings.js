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

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return merge(DEFAULTS, settings);
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
