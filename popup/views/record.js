import { icon } from '../../lib/icons.js';
import { setSettings, QUALITY } from '../../lib/settings.js';
import { clock } from '../../lib/format.js';
import { $, $$, view, send, state, toast, go, openPage, currentView, registerView } from '../core.js';

let liveTimer = 0;

registerView('record', async ({ live }) => {
  clearInterval(liveTimer);
  const { recording } = await chrome.storage.session.get('recording');
  if (!live()) return;
  const r = state.S.record;
  const src = (v, ic, t, d) => `<button class="opt src ${r.source === v ? 'on' : ''}" data-src="${v}"><span class="check">${icon('check')}</span>${icon(ic)}<span class="t">${t}</span><span class="d">${d}</span></button>`;
  const tog = (key, ic, t, d) => `<div class="card tog" data-tog="${key}"><span class="tile sm coral">${icon(ic)}</span><div class="lbl"><b>${t}</b><span>${d}</span></div><label class="switch"><input type="checkbox" ${r[key] ? 'checked' : ''}/><span></span></label></div>`;

  const liveCard = recording ? `
    <div class="card live">
      <span class="dot ${recording.paused ? 'paused' : ''}"></span>
      <div class="time" id="liveTime">00:00</div>
      <div class="src-l">${recording.starting ? 'Starting' : recording.paused ? 'Paused' : 'Recording'} · ${{ tab: 'This tab', window: 'App window', desktop: 'Entire screen' }[recording.source] || 'Screen'}</div>
      ${recording.starting ? '' : `<div class="btns">
        <button class="btn" id="pauseRec">${icon(recording.paused ? 'play' : 'pause')}${recording.paused ? 'Resume' : 'Pause'}</button>
      </div>`}
    </div>` : '';

  view.innerHTML = `
    <div class="scroll">
      <h1 class="v-title">Record Video</h1>
      <p class="v-sub">Capture your screen, camera, and audio with a few clicks.</p>
      ${liveCard}
      <div ${recording ? 'hidden' : ''}>
        <div class="sec-label">Recording Source</div>
        <div class="src3">
          ${src('tab', 'tab', 'Tab', 'Record this tab')}
          ${src('window', 'window', 'Window', 'Record an app window')}
          ${src('desktop', 'monitor', 'Desktop', 'Record your entire screen')}
        </div>
        <div class="tog2">
          ${tog('mic', 'mic', 'Microphone Audio', 'Record from your mic')}
          ${tog('systemAudio', 'speaker', 'Tab / System Audio', 'Record tab or system sound')}
          ${tog('webcam', 'webcam', 'Webcam', 'Include camera bubble')}
          ${tog('cursor', 'cursor', 'Cursor Highlight', 'Show clicks and cursor')}
        </div>
        <div class="card cd-row">${icon('timer')}<b>Countdown</b>
          <div class="seg" id="cd">${[[0, 'Off'], [3, '3s'], [5, '5s'], [10, '10s']].map(([v, l]) => `<button data-v="${v}" class="${r.countdown === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="qf2">
          <div class="card qf"><span class="tile sm">${icon('hd')}</span><div class="lbl"><b>Video Quality</b><span id="qLabel">${QUALITY[r.quality].label}</span></div>${icon('chevDown', 'chev')}
            <select id="quality">${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}" ${r.quality === k ? 'selected' : ''}>${q.label}</option>`).join('')}</select></div>
          <div class="card qf"><span class="tile sm">${icon('layers')}</span><div class="lbl"><b>FPS</b><span id="fLabel">${r.fps} FPS</span></div>${icon('chevDown', 'chev')}
            <select id="fps">${[24, 30, 60].map((f) => `<option value="${f}" ${r.fps === f ? 'selected' : ''}>${f} FPS</option>`).join('')}</select></div>
        </div>
      </div>
    </div>
    <div class="foot">
      <button class="cta" id="recGo">${icon(recording ? 'stop' : 'video')}${recording ? 'Stop Recording' : 'Start Recording'}<span class="arrow">${icon('arrowRight')}</span></button>
      <div class="rec-foot">
        <button class="btn" id="recSettings">${icon('video')}Record Settings</button>
        <button class="link-btn" id="seeRec">${icon('list')}See Recordings${icon('arrowRight')}</button>
      </div>
    </div>`;

  const save = async (patch) => { state.S = await setSettings({ record: patch }); };
  $$('[data-src]', view).forEach((b) => (b.onclick = () => { $$('[data-src]', view).forEach((x) => x.classList.toggle('on', x === b)); save({ source: b.dataset.src }); }));
  $$('[data-tog]', view).forEach((card) => {
    const input = $('input', card);
    input.onchange = () => save({ [card.dataset.tog]: input.checked });
    card.onclick = (e) => { if (!e.target.closest('.switch')) { input.checked = !input.checked; input.onchange(); } };
  });
  $$('#cd button').forEach((b) => (b.onclick = () => { $$('#cd button').forEach((x) => x.classList.toggle('on', x === b)); save({ countdown: +b.dataset.v }); }));
  $('#quality').onchange = (e) => { $('#qLabel').textContent = QUALITY[e.target.value].label; save({ quality: e.target.value }); };
  $('#fps').onchange = (e) => { $('#fLabel').textContent = `${e.target.value} FPS`; save({ fps: +e.target.value }); };
  $('#recSettings').onclick = () => openPage('settings.html#record');
  $('#seeRec').onclick = () => openPage('history.html?filter=video');

  if (recording) {
    const tick = () => {
      const t = $('#liveTime');
      if (!t) return clearInterval(liveTimer);
      const now = recording.paused ? recording.pausedAt : Date.now();
      t.textContent = clock(now - recording.startedAt - (recording.pausedTotal || 0));
    };
    if (!recording.starting) {
      tick();
      liveTimer = setInterval(tick, 500);
    }
    if ($('#pauseRec')) $('#pauseRec').onclick = async () => { await send({ type: recording.paused ? 'record-resume' : 'record-pause' }); setTimeout(() => go('record', { push: false }), 150); };
    $('#recGo').onclick = async () => { await send({ type: 'record-stop' }); window.close(); };
  } else {
    $('#recGo').onclick = () => startRecording({});
  }
});

export async function startRecording(over) {
  const r = { ...state.S.record, ...over };
  if (r.source === 'tab' && state.restricted) return toast('Chrome doesn’t allow recording this page', 'xCircle');
  // Offscreen recording can’t show permission prompts — grant mic/camera once from an extension page.
  if (r.source === 'tab' && (r.mic || r.webcam)) {
    const need = [];
    for (const [name, on] of [['microphone', r.mic], ['camera', r.webcam]]) {
      if (!on) continue;
      const st = await navigator.permissions.query({ name }).catch(() => ({ state: 'prompt' }));
      if (st.state !== 'granted') need.push(name);
    }
    if (need.length) {
      await openPage(`permissions.html?need=${need.join(',')}`);
      return window.close();
    }
  }
  await send({ type: 'record-start', options: r });
  window.close();
}

chrome.storage.session.onChanged.addListener((ch) => { if (ch.recording && currentView() === 'record') go('record', { push: false }); });
