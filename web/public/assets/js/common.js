/* Utilidades comunes de la web: iconos, formato de fechas, cabecera, avisos y widgets. */
(function () {
  'use strict';
  const API = window.PosturalAPI;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad = n => String(n).padStart(2, '0');
  const parseDk = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = parseDk(s); d.setDate(d.getDate() + n); return dk(d); };
  const isoWd = s => { const g = parseDk(s).getDay(); return g === 0 ? 7 : g; };
  const mondayOf = s => addDays(s, 1 - isoWd(s));
  const tmin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function fmtDay(d, mode) {
    const x = parseDk(d), wd = isoWd(d), m = MONTHS[x.getMonth()];
    if (mode === 'long') return `${DAY_NAMES[wd].toLowerCase()} ${x.getDate()} de ${m}`;
    if (mode === 'full') return `${DAY_NAMES[wd]}, ${x.getDate()} de ${m} de ${x.getFullYear()}`;
    if (mode === 'num') return `${x.getDate()}/${x.getMonth() + 1}`;
    return `${DAY_SHORT[wd].toLowerCase()} ${x.getDate()} ${m.slice(0, 3)}`;
  }
  const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const endTime = (start, dur) => fmt(tmin(start) + Number(dur));
  const qp = () => new URLSearchParams(location.search);
  let today = dk(new Date());

  const I = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" stroke-width="1.6"/><path d="M8 12.3l2.7 2.7L16 9.6"/></svg>',
    spine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="9" y="2.5" width="6" height="3" rx="1.5"/><rect x="8.2" y="7" width="7.6" height="3.2" rx="1.6"/><rect x="7.4" y="11.7" width="9.2" height="3.4" rx="1.7"/><rect x="6.6" y="16.6" width="10.8" height="3.6" rx="1.8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-3.9-1L4 20z"/><path d="M9 9.5c.3 1.6 1.9 3.6 3.9 4.5l1.2-1.1 1.7.8-.3 1.3c-3 .3-6.6-2.6-7-5.6l1.3-.5.8 1.6-1 1"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    seal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4v-14z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" stroke-width="2.4" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/></svg>',
    replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 108-8 8.2 8.2 0 00-5.7 2.3L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.6c2.4.1 4 1.6 4.5 4.4"/></svg>',
    staff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c.9-4 3.6-6 7-6s6.1 2 7 6"/><path d="M12 14v3.5M10.3 15.8h3.4"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="17.5" r="1.1"/></svg>',
    hours: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v3l2 1.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M7.5 13.5h3M7.5 16.5h6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
    group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="7" r="2.6"/><circle cx="5.5" cy="10" r="2.1"/><circle cx="18.5" cy="10" r="2.1"/><path d="M7.5 19c.6-3 2.3-4.6 4.5-4.6s3.9 1.6 4.5 4.6M2.5 19c.3-2 1.4-3.3 3-3.5M21.5 19c-.3-2-1.4-3.3-3-3.5"/></svg>'
  };

  function avatar(sp, cls) {
    if (!sp) return `<span class="avatar ${cls || ''}" style="background:var(--surface-2)">?</span>`;
    const ini = sp.name.replace(/^Dra?\.\s*/, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('');
    const col = `var(--c-${sp.color || 'sage'})`;
    if (sp.photo) return `<span class="avatar ${cls || ''}"><img src="${esc(sp.photo)}" alt=""></span>`;
    return `<span class="avatar ${cls || ''}" style="background:color-mix(in srgb, ${col} 26%, var(--surface));color:color-mix(in srgb, ${col} 70%, var(--ink))" aria-hidden="true">${esc(ini)}</span>`;
  }

  function toast(text, kind) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'err' ? ' err' : '');
    t.innerHTML = (kind === 'err' ? I.info : I.check) + `<span>${esc(text)}</span>`;
    box.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  function copyText(text, el) {
    const done = () => toast('Copiado: ' + text);
    const fallback = () => {
      const target = el && el.closest('[data-copy-wrap]') && el.closest('[data-copy-wrap]').querySelector('[data-copy-text]');
      if (!target) return;
      const r = document.createRange(); r.selectNodeContents(target);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Texto seleccionado: cópialo con Ctrl/Cmd + C');
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }

  /* delegación de acciones: data-act="nombre" */
  const actions = {};
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || !actions[el.dataset.act]) return;
    if (el.tagName === 'A' && (el.getAttribute('href') || '').startsWith('#')) e.preventDefault();
    actions[el.dataset.act](el, e);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const dlg = $$('[data-trap]').pop();
    if (!dlg) return;
    const f = $$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', dlg).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- calendario mensual y franjas (reserva y gestión de cita) ---------- */
  const DAY_LABEL = { available: 'con horas libres', full: 'completo', off: 'no trabaja', vacation: 'vacaciones', past: 'no disponible', closed: 'fuera del periodo de reserva' };
  function calendarHtml(o) {
    const [y, m] = o.ym.split('-').map(Number);
    const first = `${o.ym}-01`;
    const pad0 = isoWd(first) - 1;
    const days = new Date(y, m, 0).getDate();
    let cells = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<span class="dow" aria-hidden="true">${d}</span>`).join('');
    for (let i = 0; i < pad0; i++) cells += '<span class="day blank"></span>';
    for (let d = 1; d <= days; d++) {
      const key = `${o.ym}-${pad(d)}`;
      const stt = o.days ? (o.days[key] || 'off') : 'loading';
      cells += `<button type="button" class="day ${stt === 'loading' ? 'loading-day' : stt} ${key === today ? 'today' : ''}" data-act="${o.act}-day" data-date="${key}" ${stt === 'available' ? '' : 'disabled'} aria-pressed="${o.selected === key}" aria-label="${cap(fmtDay(key, 'long'))}: ${DAY_LABEL[stt] || 'cargando'}">${d}</button>`;
    }
    return `<div class="cal-head"><button class="icon-btn" type="button" data-act="${o.act}-month" data-d="-1" ${o.canPrev ? '' : 'disabled'} aria-label="Mes anterior">${I.left}</button><b aria-live="polite">${monthLabel(o.ym)}</b><button class="icon-btn" type="button" data-act="${o.act}-month" data-d="1" ${o.canNext ? '' : 'disabled'} aria-label="Mes siguiente">${I.right}</button></div>
      <div class="cal">${cells}</div>
      <div class="legend"><span><i class="l-av"></i>Con horas libres</span><span><i class="l-sel"></i>Seleccionado</span><span><i class="l-bk"></i>Completo</span><span><i class="l-na"></i>No disponible</span><span><i class="l-vac"></i>Vacaciones</span></div>`;
  }
  function slotsHtml(o) {
    if (!o.date) return `<div class="empty">Elige un día con punto naranja para ver las horas.</div>`;
    if (!o.slots) return `<div class="loading"><span class="spinner"></span>Consultando la agenda…</div>`;
    const nAv = o.slots.filter(s => s.status === 'available').length;
    return `<div class="slots-head"><b>${cap(fmtDay(o.date, 'long'))}</b><span>${nAv} ${nAv === 1 ? 'hora libre' : 'horas libres'}${o.duration ? ` · citas de ${o.duration} min` : ''}</span></div>
      ${o.slots.length ? `<div class="slots" role="group" aria-label="Horas del ${fmtDay(o.date, 'long')}">${o.slots.map(s => {
        const sel = o.selected === s.start && s.status === 'available';
        const lbl = s.status === 'available' ? (sel ? 'Elegida' : 'Libre') : s.status === 'booked' ? 'Ocupado' : 'No disp.';
        return `<button type="button" class="slot ${s.status}" data-act="${o.act}-slot" data-start="${s.start}" ${s.status === 'available' ? '' : 'disabled'} aria-pressed="${sel}" aria-label="${s.start}, ${s.status === 'available' ? 'libre' : s.status === 'booked' ? 'ocupado' : 'no disponible'}">${s.start}<small>${lbl}</small></button>`;
      }).join('')}</div>` : '<div class="empty">No hay horas este día.</div>'}`;
  }

  /* ---------- cabecera ---------- */
  function initHeader() {
    const hdr = $('.site-header'), mc = $('#m-cta');
    const onScroll = () => {
      if (hdr) hdr.classList.toggle('scrolled', window.scrollY > 8);
      if (mc) { const show = window.scrollY > 480; mc.classList.toggle('show', show); document.body.classList.toggle('mcta', show); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    // desplegables
    $$('.nav-dd > button').forEach(btn => {
      const dd = btn.parentElement;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = !dd.classList.contains('open');
        $$('.nav-dd.open').forEach(x => { x.classList.remove('open'); x.querySelector('button').setAttribute('aria-expanded', 'false'); x.querySelector('.dd-menu').hidden = true; });
        dd.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); dd.querySelector('.dd-menu').hidden = !open;
      });
    });
    document.addEventListener('click', e => { if (!e.target.closest('.nav-dd')) $$('.nav-dd.open').forEach(x => { x.classList.remove('open'); x.querySelector('button').setAttribute('aria-expanded', 'false'); x.querySelector('.dd-menu').hidden = true; }); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.nav-dd.open > button').forEach(b => b.click()); });
    actions.menu = el => { const m = $('#mobile-nav'); m.hidden = !m.hidden; el.setAttribute('aria-expanded', String(!m.hidden)); el.innerHTML = m.hidden ? I.menu : I.x; };
    actions.copy = el => copyText(el.dataset.v, el);
    // navegación activa
    const page = document.body.dataset.page;
    $$(`[data-nav="${page}"]`).forEach(a => a.setAttribute('aria-current', 'page'));
    $$('.nav-dd').forEach(dd => { if (dd.querySelector('[aria-current="page"]')) dd.classList.add('current'); });
    // sub-navegación con resaltado de sección
    const sub = $$('.subnav a[href^="#"]');
    if (sub.length && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(en => {
        if (en.isIntersecting) sub.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
      }), { rootMargin: '-40% 0px -55% 0px' });
      sub.forEach(a => { const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) io.observe(t); });
    }
  }

  /* ---------- datos del centro en la página ---------- */
  async function fillCenter() {
    try {
      const cfg = await API.config();
      if (cfg.today) today = cfg.today;
      const c = cfg.center;
      $$('[data-center]').forEach(el => { const v = c[el.dataset.center]; if (v) el.textContent = v; });
      $$('[data-tel]').forEach(el => el.setAttribute('href', 'tel:+34' + c.phone.replace(/\D/g, '')));
      $$('[data-mailto]').forEach(el => el.setAttribute('href', 'mailto:' + c.email));
      $$('[data-maps]').forEach(el => el.setAttribute('href', 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.address + ', ' + c.city)));
      $$('[data-copy-center]').forEach(el => { el.dataset.v = el.dataset.copyCenter === 'address' ? `${c.address}, ${c.city}` : c[el.dataset.copyCenter]; });
      return cfg;
    } catch (e) {
      return null;
    }
  }

  /* ---------- widgets ---------- */
  const SVC_ICON = {
    generic: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="16"/><path d="M17 24.5l5 5 9-10"/></svg>',
    valoracion: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="8" width="24" height="32" rx="4"/><path d="M19 8v-2h10v2M18 18h12M18 24h12M18 30h7"/></svg>',
    fisio: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 30h36M10 30v8M38 30v8"/><circle cx="14" cy="23" r="4"/><path d="M19 25c6-3 13-3 19 0"/><path d="M24 10c1.5 3 2.5 6 3 9M30 10c-.5 3-.5 6 0 9"/></svg>',
    rehab: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="8" width="12" height="5" rx="2.5"/><rect x="16.5" y="16" width="15" height="5.5" rx="2.75"/><rect x="15" y="24.5" width="18" height="6" rx="3"/><rect x="14" y="33.5" width="20" height="6.5" rx="3.25"/><path d="M8 14a18 18 0 000 22M40 14a18 18 0 010 22"/></svg>',
    dolor: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="24" cy="24" r="6"/><circle cx="24" cy="24" r="13" stroke-dasharray="2 4"/><circle cx="24" cy="24" r="20" stroke-dasharray="2 6" opacity=".6"/></svg>',
    entreno: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 24h20"/><rect x="6" y="16" width="5" height="16" rx="1.5"/><rect x="11" y="19" width="4" height="10" rx="1.5"/><rect x="37" y="16" width="5" height="16" rx="1.5"/><rect x="33" y="19" width="4" height="10" rx="1.5"/></svg>',
    bruxismo: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 10c5-3 8 0 10 0s5-3 10 0c6 4 3 18 0 24-2 5-5 8-7 0-1-6-2-6-3-6s-2 0-3 6c-2 8-5 5-7 0-3-6-6-20 0-24z"/></svg>'
  };
  const SITE = window.SITIO || { modulos: { clases: true }, clases: { intensidad: {} }, fotos: {} };
  const SVC_PHOTO = SITE.fotos || {};
  const FIRST_SVC = () => SITE.servicioInicial;

  async function widgetNextSlot(el) {
    try {
      const cfg = await API.config();
      const first = FIRST_SVC() || (cfg.services[0] && cfg.services[0].id);
      const svc = cfg.services.find(x => x.id === first);
      const r = await API.next(first, null, 1);
      const n = r.slots[0];
      if (!n) { el.innerHTML = `<span class="lbl"><i></i>Reserva online</span><b>Consulta la disponibilidad</b><a class="btn btn-brand btn-sm" href="reservar.html">Ver horarios</a>`; return; }
      const sp = cfg.specialists.find(s => s.id === n.specialistId);
      el.innerHTML = `<span class="lbl"><i></i>Próxima hora libre</span><b>${cap(fmtDay(n.date))} · ${n.start}</b><span>${esc(svc ? svc.name : '')}${sp ? ' con ' + esc(sp.name) : ''}</span>
        <a class="btn btn-brand btn-sm" href="reservar.html?servicio=${first}&especialista=${n.specialistId}&fecha=${n.date}&hora=${n.start}">Reservar esta hora ${I.arrow}</a>`;
    } catch (e) {
      el.innerHTML = `<span class="lbl">Reserva online</span><b>Pide tu cita</b><a class="btn btn-brand btn-sm" href="reservar.html">Reservar</a>`;
    }
  }

  async function widgetServices(el) {
    const cfg = await API.config();
    const cards = cfg.services.map(s => {
      const ph = SVC_PHOTO[s.id];
      const thumb = ph ? `<img src="${ph}" alt="" loading="lazy">` : (SVC_ICON[s.id] || SVC_ICON.generic);
      return `<a class="svc" href="servicios.html#${s.id}" aria-label="${esc(s.name)}: ${esc(s.short)}">
        <span class="thumb" aria-hidden="true">${thumb}</span>
        <span class="txt"><span class="h">${esc(s.name)}</span><span class="p">${esc(s.short || '')}</span><span class="go">Ver más ${I.arrow}</span></span></a>`;
    }).join('');
    el.innerHTML = cards;
  }

  async function widgetTeam(el) {
    const cfg = await API.config();
    const limit = Number(el.dataset.limit || 99);
    const svcName = id => (cfg.services.find(s => s.id === id) || {}).name;
    const sps = cfg.specialists.slice(0, limit);
    if (!sps.length) {
      el.innerHTML = `<div class="team-empty"><b>Estamos actualizando las fichas de nuestro equipo.</b><span>Mientras tanto puedes reservar por servicio o llamarnos.</span><a class="btn btn-brand btn-sm" href="reservar.html">Reservar cita</a></div>`;
      return;
    }
    el.innerHTML = sps.map(sp => `<article class="member">
        <div class="member-top">${avatar(sp)}<div style="min-width:0"><h3>${esc(sp.name)}</h3><p class="role">${esc(sp.role)}</p></div></div>
        ${sp.demo ? '<div><span class="badge badge-demo">Perfil de demostración</span></div>' : '<div></div>'}
        <div style="display:grid;gap:10px;align-content:start"><p class="bio">${esc(sp.bio)}</p><div class="svc-tags">${sp.serviceIds.map(id => `<span>${esc(svcName(id) || id)}</span>`).join('')}</div>
        <p class="next" data-next="${sp.id}" data-svc="${sp.serviceIds[0] || ''}">Buscando el próximo hueco…</p></div>
        <div><a class="btn btn-primary btn-sm" href="reservar.html?especialista=${sp.id}${sp.serviceIds.length === 1 ? '&servicio=' + sp.serviceIds[0] : ''}">Reservar con ${esc(sp.name.split(' ')[0] === 'Dra.' ? 'la doctora' : sp.name.split(' ')[0])}</a></div>
      </article>`).join('');
    $$('[data-next]', el).forEach(async p => {
      if (!p.dataset.svc) { p.textContent = ''; return; }
      try {
        const r = await API.next(p.dataset.svc, [p.dataset.next], 1);
        const n = r.slots[0];
        p.innerHTML = n ? `Próximo hueco: <b>${fmtDay(n.date)} · ${n.start}</b>` : 'Sin huecos online en las próximas semanas';
      } catch (e) { p.textContent = ''; }
    });
  }

  const LEVEL_BARS = (SITE.clases && SITE.clases.intensidad) || {};
  async function widgetLevels(el) {
    const cfg = await API.config();
    el.innerHTML = cfg.classTypes.map(t => {
      const n = LEVEL_BARS[t.id] || 2;
      const meter = [1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}" style="height:${4 + i * 4}px"></i>`).join('');
      return `<div class="level"><div class="level-top"><h3 style="font-family:var(--f-display);font-size:1.15rem">${esc(t.name)}</h3><span class="level-meter" aria-label="Intensidad ${n} de 4">${meter}</span></div><p>${esc(t.text)}</p>${t.published ? '' : '<span class="badge badge-muted" style="width:fit-content">Descripción por confirmar</span>'}<a class="slots-link" href="horarios.html?modalidad=${t.id}#clases">Ver horarios y plazas →</a></div>`;
    }).join('');
  }

  /* horario de clases con plazas */
  async function widgetClasses(el) {
    const st = { type: qp().get('modalidad') || 'all', week: 0 };
    const cfg = await API.config();
    async function render() {
      const mon = addDays(mondayOf(today), st.week * 7);
      const chips = [`<button class="chip" type="button" data-cl="type" data-v="all" aria-pressed="${st.type === 'all'}">Todas</button>`]
        .concat(cfg.classTypes.map(t => `<button class="chip" type="button" data-cl="type" data-v="${t.id}" aria-pressed="${st.type === t.id}">${esc(t.name)}</button>`)).join('');
      const head = `<div class="sched-toolbar"><div class="chips" role="group" aria-label="Filtrar por modalidad">${chips}</div>
        <div class="week-nav"><button class="icon-btn" type="button" data-cl="week" data-v="-1" ${st.week <= 0 ? 'disabled' : ''} aria-label="Semana anterior">${I.left}</button><b>${fmtDay(mon, 'num')} – ${fmtDay(addDays(mon, 4), 'num')}</b><button class="icon-btn" type="button" data-cl="week" data-v="1" ${st.week >= 3 ? 'disabled' : ''} aria-label="Semana siguiente">${I.right}</button></div></div>`;
      el.innerHTML = head + `<div class="loading"><span class="spinner"></span>Cargando plazas…</div>`;
      let ses;
      try { ses = (await API.classes(mon, 5)).sessions; } catch (e) { el.innerHTML = head + `<div class="notice err">${I.info}<span>${esc(e.message)}</span></div>`; return; }
      const cols = [0, 1, 2, 3, 4].map(i => {
        const d = addDays(mon, i);
        const list = ses.filter(x => x.date === d && (st.type === 'all' || x.typeId === st.type));
        const items = list.length ? list.map(x => {
          const pct = x.capacity ? Math.round(x.taken / x.capacity * 100) : 100;
          const dis = x.past || x.full;
          const label = x.past ? 'Ya empezó' : x.full ? '<b>Completa</b>' : `${x.free} ${x.free === 1 ? 'plaza libre' : 'plazas libres'}`;
          const inner = `<span class="t">${x.start} – ${x.end}</span><span class="n">${esc(x.typeName)}</span><span class="seatbar" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="s"><span>${label}</span><span>${x.taken}/${x.capacity}</span></span>`;
          return dis ? `<div class="sess ${x.full ? 'full' : ''} ${x.past ? 'past' : ''}" aria-label="${esc(x.typeName)} ${x.start}: ${x.full ? 'completa' : 'ya empezó'}">${inner}</div>`
            : `<a class="sess" href="reservar.html?clase=${x.slotId}&fecha=${x.date}" aria-label="${esc(x.typeName)}, ${fmtDay(x.date, 'long')} a las ${x.start}. ${x.free} plazas libres de ${x.capacity}. Reservar">${inner}</a>`;
        }).join('') : '<p class="empty" style="padding:14px;font-size:.82rem">Sin clases de esta modalidad</p>';
        return `<div class="sched-col ${d === today ? 'today' : ''}"><h4>${DAY_NAMES[i + 1]} <span>${fmtDay(d, 'num')}</span></h4><div class="sched-list">${items}</div></div>`;
      }).join('');
      el.innerHTML = head + `<div class="sched-scroll"><div class="sched">${cols}</div></div>
        <p class="sched-note">${I.info}<span>Toca una clase para reservar tu plaza. Si no sabes qué grupo te corresponde, empieza por una <a href="reservar.html?servicio=${FIRST_SVC()}">valoración inicial</a>.</span></p>`;
      $$('a.sess', el).forEach(a => a.style.textDecoration = 'none');
    }
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cl]');
      if (!b) return;
      if (b.dataset.cl === 'type') st.type = b.dataset.v;
      else st.week = Math.max(0, Math.min(3, st.week + Number(b.dataset.v)));
      render();
    });
    render();
  }

  /* formulario de contacto */
  function initContactForm(f) {
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f).entries());
      data.privacyAccepted = !!f.elements.privacy.checked;
      const box = $('#cf-status', f);
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await API.contact(data);
        f.reset();
        box.innerHTML = `<div class="notice ok">${I.check}<span>Mensaje enviado. Te responderemos lo antes posible${API.mode === 'demo' ? ' (demo: queda guardado en el Área profesional, no se envía)' : ''}.</span></div>`;
      } catch (err) {
        box.innerHTML = `<div class="notice err">${I.info}<span>${esc(err.message)}</span></div>`;
      } finally { btn.disabled = false; }
    });
  }

  async function init() {
    initHeader();
    await fillCenter();
    const W = { 'next-slot': widgetNextSlot, services: widgetServices, team: widgetTeam, levels: widgetLevels, classes: widgetClasses };
    $$('[data-widget]').forEach(el => { const fn = W[el.dataset.widget]; if (fn) fn(el).catch(err => { el.innerHTML = `<div class="notice err">${I.info}<span>${esc(err.message)}</span></div>`; }); });
    const cf = $('#contact-form'); if (cf) initContactForm(cf);
    document.dispatchEvent(new CustomEvent('postural:ready'));
  }

  window.UI = { esc, $, $$, I, avatar, toast, copyText, actions, fmtDay, monthLabel, cap, endTime, addDays, mondayOf, isoWd, tmin, fmt, dk, parseDk, qp, DAY_NAMES, MONTHS, calendarHtml, slotsHtml, SVC_ICON, SVC_PHOTO, get today() { return today; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
