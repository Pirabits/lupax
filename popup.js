// Popup entry: header controls, view registration, boot. Each view lives in popup/views/.
import { hydrateIcons } from './lib/icons.js';
import { $, send, go, back, home, menu, openPage, shortcutMap, hasView } from './popup/core.js';
import { renderActivity } from './popup/views/home.js';
import { renderRecentCaptures } from './popup/views/capture.js';
import { startRecording } from './popup/views/record.js';
import { renderPicked } from './popup/views/inspect.js';
import './popup/views/assets.js';
import './popup/views/help.js';

hydrateIcons(document);

$('#home').onclick = home;
$('#back').onclick = back;
$('#settings').onclick = () => openPage('settings.html');
$('#help').onclick = () => go('help');
$('#quick').onclick = async (e) => {
  const anchor = e.currentTarget;
  const sc = await shortcutMap();
  const run = (mode) => async () => { await send({ type: 'capture', mode }); window.close(); };
  menu(anchor, [
    { label: 'Quick actions' },
    { icon: 'monitor', text: 'Capture visible area', kbd: sc['capture-visible'], onClick: run('visible') },
    { icon: 'region', text: 'Capture selected region', kbd: sc['capture-area'], onClick: run('area') },
    { icon: 'fullpage', text: 'Capture full page', kbd: sc['capture-full'], onClick: run('full') },
    { icon: 'video', text: 'Record this tab', kbd: sc['toggle-recording'], onClick: () => startRecording({ source: 'tab' }) },
    'hr',
    { icon: 'eyedropper', text: 'Pick a color', onClick: async () => { await send({ type: 'pick-color' }); window.close(); } },
    { icon: 'target', text: 'Inspect an element', onClick: async () => { await send({ type: 'inspect', on: true }); window.close(); } },
    { icon: 'shield', text: 'Accessibility scan', onClick: () => go('assets', { focus: 'a11y' }) },
  ]);
};

const { recording } = await chrome.storage.session.get('recording');
const requested = new URLSearchParams(location.search).get('view');
go(recording ? 'record' : hasView(requested) ? requested : 'home', { push: false });

chrome.storage.local.onChanged.addListener((ch) => {
  if (ch.historyRev) { renderActivity(); renderRecentCaptures(); }
  if (ch.colorHistory) renderPicked();
});
