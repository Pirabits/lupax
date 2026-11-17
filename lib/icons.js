// Inline SVG icon set (24×24, stroke-based) + the LupaX logo.
const P = {
  bolt: '<path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12L13 2Z"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.6-2.8 4"/><path d="M12 17.4h.01"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9Z"/><circle cx="12" cy="13" r="3.6"/>',
  video: '<rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="m16 10.5 5.5-3v9l-5.5-3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m21 16-5-5L6 20"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m8.8 12.2 2.2 2.2 4.4-4.6"/>',
  sparkles: '<path d="M10 3.5 11.6 8a3 3 0 0 0 1.9 1.9L18 11.5 13.5 13a3 3 0 0 0-1.9 1.9L10 19.5 8.4 15A3 3 0 0 0 6.5 13L2 11.5 6.5 10A3 3 0 0 0 8.4 8L10 3.5Z"/><path d="M18.5 3v4M20.5 5h-4M19 17v3M20.5 18.5h-3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  region: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M11 4h2M11 20h2M4 11v2M20 11v2"/>',
  fullpage: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 12.5h6M9 16h6M9 9h2"/>',
  scroll: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M10 2.5h4M18.5 6 20 4.5"/>',
  imageFile: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m3 15 4.5-4.5L13 16M14 14l2-2 5 5"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  pen: '<path d="m4 20 1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20Z"/><path d="m14 7 3 3"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z"/>',
  tab: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01M11.5 6.8h.01"/>',
  window: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  speaker: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4v-5Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  webcam: '<rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="m16 10.5 5.5-3v9l-5.5-3"/>',
  cursor: '<path d="m5 3 14 7.5-6.2 1.6L10 18.5 5 3Z"/><path d="m13 12.5 5 5"/>',
  hd: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 9v6M7 12h3.5M10.5 9v6M14 9v6h1.5a3 3 0 0 0 0-6H14Z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7h2a4.6 4.6 0 0 0 4.6-4.6C21 6.4 17 3 12 3Z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10" cy="7.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor"/>',
  type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  spacing: '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.6"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  alert: '<path d="M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5M12 17.2h.01"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  font: '<path d="M3 18 7.5 6h1L13 18M4.6 14h6.8"/><path d="M15.5 11.2a2.8 2.8 0 0 1 5 1.8V18M20.5 14.5h-2.3a2 2 0 0 0 0 4c1.2 0 2.3-.8 2.3-2.2"/>',
  cube: '<path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Z"/><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2"/>',
  stack: '<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.5h6V7"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  eyedropper: '<path d="m14.5 4.5 5 5M17 2.8a2.6 2.6 0 0 1 3.7 3.7l-2.6 2.6-3.7-3.7L17 2.8Z"/><path d="M14.4 5.4 5 14.8V19h4.2l9.4-9.4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  element: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><path d="m12 12 8.5 3-3.6 1.4-1.4 3.6L12 12Z"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M11 4v2M11 8v2M11 12v2M10 16h2v2.5h-2z"/>',
  text: '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
  arrowTool: '<path d="M5 19 19 5M10 5h9v9"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  line: '<path d="M5 19 19 5"/>',
  highlighter: '<path d="m9 15-2 2v3h3l2-2"/><path d="m9 15 7.5-9.5a2.1 2.1 0 0 1 3 3L12 18l-3-3Z"/><path d="M4 21h7"/>',
  blur: '<rect x="4" y="4" width="4" height="4"/><rect x="10" y="4" width="4" height="4" opacity=".55"/><rect x="16" y="4" width="4" height="4"/><rect x="4" y="10" width="4" height="4" opacity=".55"/><rect x="10" y="10" width="4" height="4"/><rect x="16" y="10" width="4" height="4" opacity=".55"/><rect x="4" y="16" width="4" height="4"/><rect x="10" y="16" width="4" height="4" opacity=".55"/><rect x="16" y="16" width="4" height="4"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  move: '<path d="M5 3.5 18 10l-5.6 1.4L10 17 5 3.5Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  button: '<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M8 12h8"/>',
  input: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4"/>',
  card: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M7 14h6M7 16.5h4"/>',
  ruler: '<path d="m3 16.5 13.5-13.5 4.5 4.5L7.5 21 3 16.5Z"/><path d="m7 12.5 2 2M10 9.5l2 2M13 6.5l2 2"/>',
  radius: '<path d="M4 20V11a7 7 0 0 1 7-7h9"/>',
  shadow: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M20.5 8v10.5a2 2 0 0 1-2 2H8"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
};

export function icon(name, cls = '') {
  return `<span class="ico ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${P[name] || ''}</svg></span>`;
}

export function logo(size = 34) {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="20" cy="20" r="13.5" fill="none" stroke="#7ab8f5" stroke-width="3.6"/><path d="M14.8 14.8 25.2 25.2M25.2 14.8 14.8 25.2" stroke="#7ab8f5" stroke-width="3.2" fill="none"/><path d="M30.2 30.2 41.5 41.5" stroke="#7ab8f5" stroke-width="5.6" stroke-linecap="round" fill="none"/>
  </svg>`;
}

/** Replace every <i data-icon="name"> in a root with the SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) {
    el.outerHTML = icon(el.dataset.icon, el.className);
  }
  for (const el of root.querySelectorAll('i[data-logo]')) {
    el.outerHTML = logo(Number(el.dataset.logo) || 34);
  }
}
