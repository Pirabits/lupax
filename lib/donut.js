// Accessibility score ring, shared by the popup and the report page. Colors come from --donut-* tokens in styles/ui.css.

/** viewBox is size×size; r and stroke in the same units. */
export function scoreDonut(score, { size = 132, r = 52, stroke = 12, label = 'Overall' } = {}) {
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const id = `donut-${Math.random().toString(36).slice(2, 8)}`;
  return `<div class="donut"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${pct}% ${label}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--donut-1)"/><stop offset=".55" style="stop-color:var(--donut-2)"/><stop offset="1" style="stop-color:var(--donut-3)"/>
      </linearGradient></defs>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--donut-track)" stroke-width="${stroke}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(C * pct) / 100} ${C}"/>
    </svg><div class="c"><b>${pct}%</b><span>${label}</span></div></div>`;
}
