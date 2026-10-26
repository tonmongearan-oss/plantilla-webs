/* Reserva online (página reservar.html): cita individual por especialista o plaza en clase. */
(function () {
  'use strict';
  const API = window.PosturalAPI;
  const SITE = window.SITIO || { modulos: { clases: true }, clases: { nombre: 'Postural', etiqueta: 'clases de Postural' } };
  const CLS = SITE.modulos && SITE.modulos.clases && SITE.clases;   // módulo de clases en grupo (puede no existir)
  const { esc, $, I, avatar, actions, fmtDay, cap, endTime, addDays, mondayOf, calendarHtml, slotsHtml, qp } = window.UI;
  const root = document.getElementById('booking-app');
  if (!root) return;

  const STEPS_IND = ['Servicio', 'Especialista', 'Fecha y hora', 'Tus datos', 'Confirmar'];
  const STEPS_CLS = ['Clase', 'Tus datos', 'Confirmar'];
  const BK = {
    cfg: null, mode: 'individual', step: 1, serviceId: null, specialistId: null, date: null, start: null, month: null,
    days: null, slots: null, nextBySp: {}, nextAny: null, classWeek: 0, classType: 'all', sessions: null, session: null,
    form: { name: '', phone: '', email: '', whatsappOptIn: false, privacy: false, website: '' }, errors: {}, error: null, busy: false, result: null
  };
  const today = () => window.UI.today;
  const svc = () => BK.cfg.services.find(s => s.id === BK.serviceId);
  const spOf = id => BK.cfg.specialists.find(s => s.id === id);
  const svcName = id => { const x = BK.cfg && BK.cfg.services.find(s => s.id === id); return x ? x.name : ''; };
  const spsFor = id => BK.cfg.specialists.filter(s => s.serviceIds.includes(id));
  const eur = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
  /** Señal que se paga online al reservar (null si no aplica). */
  function deposit(serviceId) {
    const pay = BK.cfg && BK.cfg.payments;
    const sv = BK.cfg.services.find(s => s.id === (serviceId || BK.serviceId));
    if (BK.mode !== 'individual' || !pay || !pay.enabled || !sv || !(sv.price > 0)) return null;
    const now = Math.round(sv.price * pay.depositPercent) / 100;
    return now >= 0.5 ? { now, rest: Math.max(0, sv.price - now), price: sv.price, pct: pay.depositPercent, test: pay.testMode } : null;
  }

  /* ---------- carga de datos según el paso ---------- */
  async function loadMonth() {
    BK.days = null; render();
    try { BK.days = (await API.month(BK.specialistId, BK.serviceId, BK.month)).days; }
    catch (e) { BK.error = e.message; BK.days = {}; }
    render();
  }
  async function loadDay() {
    BK.slots = null; render();
    try { BK.slots = (await API.day(BK.specialistId, BK.serviceId, BK.date)).slots; }
    catch (e) { BK.error = e.message; BK.slots = []; }
    render();
  }
  async function enterCalendar(prefDate) {
    BK.step = 3; BK.start = null; BK.slots = null; BK.error = null;
    BK.month = (prefDate || today()).slice(0, 7);
    BK.date = prefDate || null;
    render();
    if (!prefDate) {
      try {
        const n = (await API.next(BK.serviceId, [BK.specialistId], 1)).slots[0];
        if (n) { BK.date = n.date; BK.month = n.date.slice(0, 7); }
      } catch (e) { /* sin sugerencia */ }
    }
    await Promise.all([loadMonth(), BK.date ? loadDay() : Promise.resolve()]);
  }
  async function enterSpecialists() {
    BK.step = 2; BK.specialistId = null; BK.nextAny = null; BK.nextBySp = {}; render();
    const list = spsFor(BK.serviceId);
    await Promise.all([
      API.next(BK.serviceId, null, 6).then(r => { BK.nextAny = r.slots; }).catch(() => { BK.nextAny = []; }),
      ...list.map(sp => API.next(BK.serviceId, [sp.id], 3).then(r => { BK.nextBySp[sp.id] = r.slots; }).catch(() => { BK.nextBySp[sp.id] = []; }))
    ]);
    render();
  }
  async function loadClasses() {
    BK.sessions = null; render();
    try { BK.sessions = (await API.classes(addDays(mondayOf(today()), BK.classWeek * 7), 5)).sessions; }
    catch (e) { BK.error = e.message; BK.sessions = []; }
    render();
  }

  /* ---------- piezas ---------- */
  function stepper() {
    const labels = BK.mode === 'class' ? STEPS_CLS : STEPS_IND;
    const cur = BK.result ? labels.length + 1 : BK.step;
    return `<nav class="stepper" aria-label="Pasos de la reserva"><ol>${labels.map((l, i) => {
      const n = i + 1, cls = n < cur ? 'done' : n === cur ? 'cur' : '';
      return `<li class="${cls}" ${n === cur ? 'aria-current="step"' : ''}><i>${n < cur ? '✓' : n}</i>${l}</li>`;
    }).join('')}</ol></nav>`;
  }
  function summaryRows() {
    if (BK.mode === 'class') {
      const s = BK.session;
      return [['Tipo de reserva', `Plaza en clase de ${CLS ? CLS.nombre : ''}`], ['Modalidad', s ? s.typeName : ''], ['Día', s ? cap(fmtDay(s.date, 'long')) : ''], ['Hora', s ? `${s.start} – ${s.end}` : ''], ['Plazas libres', s ? `${s.free} de ${s.capacity}` : '']];
    }
    const sv = BK.serviceId && svc(), sp = BK.specialistId && spOf(BK.specialistId);
    return [['Tipo de reserva', 'Cita individual'], ['Servicio', sv ? sv.name : ''], ['Especialista', sp ? sp.name : ''], ['Fecha', BK.date && BK.start ? cap(fmtDay(BK.date, 'long')) : ''], ['Hora', BK.start && sv ? `${BK.start} – ${endTime(BK.start, sv.duration)}` : ''], ['Duración', sv ? `${sv.duration} min` : '']].concat(deposit() ? [['Precio', eur(deposit().price)], ['Señal al reservar', `${eur(deposit().now)} (${deposit().pct} %)`]] : []);
  }
  function side() {
    const c = BK.cfg.center;
    return `<aside class="modal-side" aria-label="Resumen de la reserva">${summaryRows().map(([k, v]) => `<div class="sum-row"><b>${k}</b><span class="${v ? '' : 'muted-val'}">${v ? esc(v) : 'Sin elegir'}</span></div>`).join('')}
      <div class="notice">${I.phone}<span>¿Prefieres reservar por teléfono? Llámanos al <b>${esc(c.phone)}</b>.</span></div>
      ${API.mode === 'demo' ? `<div class="notice warn">${I.info}<span>Demo: la reserva se guarda en este navegador y aparece en el Área profesional.</span></div>` : ''}</aside>`;
  }

  function stepService() {
    const svcs = BK.cfg.services.filter(s => spsFor(s.id).length);
    return `<h2 class="h3" id="bk-step-title" tabindex="-1">¿Qué necesitas?</h2><p class="hint">${CLS ? `Elige una consulta individual o una plaza en las ${esc(CLS.etiqueta)}.` : 'Elige el servicio que quieres reservar.'}</p>
      <div class="pick-grid">
        ${svcs.map(s => `<button type="button" class="pick" data-act="bk-service" data-id="${s.id}" aria-pressed="${BK.serviceId === s.id}">
          <span class="t">${esc(s.name)}</span><span class="d">${esc(s.short || '')}</span><span class="m"><span>${s.duration} min</span><span>${spsFor(s.id).length} ${spsFor(s.id).length === 1 ? 'especialista' : 'especialistas'}</span>${s.price != null ? `<span>${deposit(s.id) ? `${eur(s.price)} · señal ${eur(deposit(s.id).now)}` : `${s.price} € orientativo`}</span>` : ''}</span></button>`).join('')}
        ${CLS ? `<button type="button" class="pick alt" data-act="bk-mode" data-v="class"><span class="t">Clase de ${esc(CLS.nombre)} (grupo) ${I.arrow.replace('<svg', '<svg width="18" height="18"')}</span><span class="d">Reserva una plaza por modalidad, día y hora.</span></button>` : ''}
      </div>
      ${svcs.length < BK.cfg.services.length ? `<p class="hint" style="margin-top:14px">Algunos servicios solo se reservan por teléfono por ahora.</p>` : ''}`;
  }

  function stepSpecialist() {
    const s = svc(), list = spsFor(BK.serviceId);
    const chip = (x, withName) => { const sp = spOf(x.specialistId); return `<button type="button" class="chip" data-act="bk-quick" data-sp="${x.specialistId}" data-date="${x.date}" data-start="${x.start}" aria-label="Reservar ${fmtDay(x.date, 'long')} a las ${x.start}${sp ? ' con ' + esc(sp.name) : ''}">${fmtDay(x.date)} · ${x.start}${withName && sp ? ' · ' + esc(sp.name.split(' ')[0] === 'Dra.' ? sp.name : sp.name.split(' ')[0]) : ''}</button>`; };
    const loading = '<span class="m"><span class="spinner" style="width:14px;height:14px"></span> buscando…</span>';
    return `<h2 class="h3" id="bk-step-title" tabindex="-1">Elige especialista</h2><p class="hint">Profesionales que ofrecen <b>${esc(s.name)}</b>. Cada uno tiene su propia agenda.</p>
      <div class="pick-grid">
        ${list.length > 1 ? `<div class="pick alt"><span class="t">Sin preferencia</span><span class="d">Primeras horas libres de todo el equipo:</span>
          <div class="next-chips">${BK.nextAny === null ? loading : BK.nextAny.length ? BK.nextAny.map(x => chip(x, true)).join('') : '<span class="m">Sin huecos online próximos</span>'}</div></div>` : ''}
        ${list.map(sp => {
          const nx = BK.nextBySp[sp.id];
          return `<div class="pick sp-pick">${avatar(sp, 'sm')}<div>
            <span class="t" style="justify-content:flex-start;flex-wrap:wrap">${esc(sp.name)} ${sp.demo ? '<span class="badge badge-demo">Demo</span>' : ''}</span>
            <span class="d">${esc(sp.role)}</span>
            <span class="m">Próximas horas libres:</span>
            <div class="next-chips">${nx === undefined ? loading : nx.length ? nx.map(x => chip(x)).join('') : '<span class="m">Sin huecos próximos</span>'}</div>
            <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="bk-sp" data-id="${sp.id}">${I.cal}Ver su calendario</button></div>
          </div></div>`;
        }).join('')}
      </div>
      <div class="nav-row"><button class="btn btn-quiet" type="button" data-act="bk-back">${I.left}Cambiar servicio</button></div>`;
  }

  function stepCalendar() {
    const s = svc(), sp = spOf(BK.specialistId);
    const horizon = addDays(today(), (BK.cfg.booking && BK.cfg.booking.horizonDays) || 60);
    return `<h2 class="h3" id="bk-step-title" tabindex="-1">Agenda de ${esc(sp.name)}</h2><p class="hint">${esc(s.name)} · Solo se muestran los días y horas en que trabaja este especialista y que siguen libres.</p>
      ${BK.error ? `<div class="notice err" role="alert" style="margin-bottom:14px">${I.info}<span>${esc(BK.error)}</span></div>` : ''}
      <div class="cal-wrap">
        <div>${calendarHtml({ ym: BK.month, days: BK.days, selected: BK.date, act: 'bk', canPrev: BK.month > today().slice(0, 7), canNext: `${BK.month}-31` < horizon })}</div>
        <div>${slotsHtml({ date: BK.date, slots: BK.slots, selected: BK.start, duration: s.duration, act: 'bk' })}</div>
      </div>
      <div class="nav-row"><button class="btn btn-quiet" type="button" data-act="bk-back">${I.left}Cambiar especialista</button><button class="btn btn-brand" type="button" data-act="bk-next" ${BK.start ? '' : 'disabled'}>Continuar ${I.arrow}</button></div>`;
  }

  function stepClass() {
    const mon = addDays(mondayOf(today()), BK.classWeek * 7);
    const chips = [`<button class="chip" type="button" data-act="bk-ctype" data-type="all" aria-pressed="${BK.classType === 'all'}">Todas</button>`].concat(BK.cfg.classTypes.map(t => `<button class="chip" type="button" data-act="bk-ctype" data-type="${t.id}" aria-pressed="${BK.classType === t.id}">${esc(t.name)}</button>`)).join('');
    let body;
    if (!BK.sessions) body = '<div class="loading"><span class="spinner"></span>Cargando clases…</div>';
    else {
      const days = [];
      for (let i = 0; i < 5; i++) {
        const d = addDays(mon, i);
        const ses = BK.sessions.filter(x => x.date === d && (BK.classType === 'all' || x.typeId === BK.classType));
        if (!ses.length) continue;
        days.push(`<div class="class-day"><h4>${cap(fmtDay(d, 'long'))}</h4><div class="class-rows">${ses.map(x => {
          const pct = x.capacity ? Math.round(x.taken / x.capacity * 100) : 100;
          return `<button type="button" class="sess ${x.full ? 'full' : ''} ${x.past ? 'past' : ''}" data-act="bk-class" data-slot="${x.slotId}" data-date="${x.date}" ${x.full || x.past ? 'disabled' : ''}>
            <span class="t">${x.start} – ${x.end}</span><span class="n">${esc(x.typeName)}</span><span class="seatbar" aria-hidden="true"><i style="width:${pct}%"></i></span>
            <span class="s"><span>${x.past ? 'Ya empezó' : x.full ? '<b>Completa</b>' : `${x.free} ${x.free === 1 ? 'plaza libre' : 'plazas libres'}`}</span><span>${x.taken}/${x.capacity}</span></span></button>`;
        }).join('')}</div></div>`);
      }
      body = days.join('') || '<div class="empty">No hay clases de esta modalidad esta semana.</div>';
    }
    return `<h2 class="h3" id="bk-step-title" tabindex="-1">Elige tu clase de ${esc(CLS ? CLS.nombre : '')}</h2>${SITE.servicioInicial && svcName(SITE.servicioInicial) ? `<p class="hint">Si no sabes qué grupo te corresponde, empieza por <button class="btn-quiet" style="border:0;padding:0;text-decoration:underline;color:var(--sage-deep);font-weight:600" data-act="bk-mode" data-v="individual" data-svc="${SITE.servicioInicial}">${esc(svcName(SITE.servicioInicial).toLowerCase())}</button>.</p>` : ''}
      <div class="sched-toolbar"><div class="chips" role="group" aria-label="Modalidad">${chips}</div>
      <div class="week-nav"><button class="icon-btn" type="button" data-act="bk-cweek" data-d="-1" ${BK.classWeek <= 0 ? 'disabled' : ''} aria-label="Semana anterior">${I.left}</button><b>${fmtDay(mon, 'num')} – ${fmtDay(addDays(mon, 4), 'num')}</b><button class="icon-btn" type="button" data-act="bk-cweek" data-d="1" ${BK.classWeek >= 3 ? 'disabled' : ''} aria-label="Semana siguiente">${I.right}</button></div></div>
      ${body}`;
  }

  function stepData() {
    const f = BK.form, e = BK.errors;
    const fld = (id, label, type, ac, extra) => `<div class="field"><label for="bk-${id}">${label}</label><input class="input" id="bk-${id}" data-bk="${id}" type="${type}" autocomplete="${ac}" value="${esc(f[id])}" ${e[id] ? `aria-invalid="true" aria-describedby="bk-${id}-err"` : ''} ${extra || ''}>${e[id] ? `<span class="err-msg" id="bk-${id}-err">${esc(e[id])}</span>` : ''}</div>`;
    const wa = BK.cfg.whatsappEnabled || API.mode === 'demo';
    return `<h2 class="h3" id="bk-step-title" tabindex="-1">Tus datos de contacto</h2><p class="hint">Solo lo necesario para gestionar la cita. No incluyas información médica.</p>
      <form id="bk-form" novalidate style="display:grid;gap:14px;max-width:580px">
        ${fld('name', 'Nombre y apellidos', 'text', 'name', 'required')}
        <div class="grid2">${fld('phone', 'Teléfono móvil', 'tel', 'tel', 'inputmode="tel" required')}${fld('email', 'Correo electrónico', 'email', 'email', 'required')}</div>
        <div class="hp" aria-hidden="true"><label for="bk-website">No rellenes este campo</label><input id="bk-website" data-bk="website" tabindex="-1" autocomplete="off"></div>
        <div class="consent">
          ${wa ? `<label class="check"><input type="checkbox" data-bk="whatsappOptIn" ${f.whatsappOptIn ? 'checked' : ''}><span>Quiero recibir la confirmación y los recordatorios de la cita por <b>WhatsApp</b>. Puedo darme de baja respondiendo BAJA.</span></label>` : ''}
          <label class="check"><input type="checkbox" data-bk="privacy" ${f.privacy ? 'checked' : ''} ${e.privacy ? 'aria-invalid="true"' : ''}><span>He leído y acepto la <a href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a>.</span></label>
          ${e.privacy ? `<span class="err-msg">${esc(e.privacy)}</span>` : ''}
        </div>
        <div class="nav-row" style="margin-top:4px"><button class="btn btn-quiet" type="button" data-act="bk-back">${I.left}Atrás</button><button class="btn btn-brand" type="submit">Revisar reserva ${I.arrow}</button></div>
      </form>`;
  }
  function validate() {
    const f = BK.form, e = {};
    if (f.name.trim().length < 3 || !/\s/.test(f.name.trim())) e.name = 'Escribe tu nombre y al menos un apellido.';
    if (f.phone.replace(/\D/g, '').length < 9) e.phone = 'El teléfono debe tener al menos 9 cifras.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Revisa el formato del correo (ejemplo@dominio.com).';
    if (!f.privacy) e.privacy = 'Necesitamos que aceptes la política de privacidad para guardar tu cita.';
    BK.errors = e;
    return !Object.keys(e).length;
  }

  function stepReview() {
    const rows = summaryRows().slice(1).filter(r => r[0] !== 'Plazas libres').concat([['Nombre', BK.form.name], ['Teléfono', BK.form.phone], ['Correo', BK.form.email], ['WhatsApp', BK.form.whatsappOptIn ? 'Sí, quiero recordatorios' : 'No']]);
    const d = deposit();
    const cancelH = (BK.cfg.booking && BK.cfg.booking.cancelMinNoticeHours) || 12;
    const payNote = d ? `<div class="notice" style="margin-bottom:14px">${I.card}<span>Para confirmar la cita pagarás ahora una <b>señal de ${eur(d.now)}</b> (${d.pct} %) con tarjeta, Apple Pay o Google Pay en la página segura de Stripe.${d.rest > 0 ? ` El resto (${eur(d.rest)}) se paga en el centro.` : ''} Si cancelas con más de ${cancelH} h de antelación, te la devolvemos.</span></div>
      ${d.test ? `<div class="notice warn" style="margin-bottom:14px">${I.info}<span>Modo de prueba: no se cobra nada de verdad. Usa la tarjeta <b>4242 4242 4242 4242</b>, cualquier fecha futura y cualquier CVC.</span></div>` : ''}` : '';
    const btn = BK.busy ? `<span class="spinner" style="border-top-color:#fff"></span>${d ? 'Abriendo el pago seguro…' : 'Reservando…'}` : d ? `${I.card}Pagar señal de ${eur(d.now)}` : I.check + 'Confirmar reserva';
    return `<h2 class="h3" id="bk-step-title" tabindex="-1">Revisa y confirma</h2><p class="hint">Comprueba los datos antes de confirmar.</p>
      <div class="review">${rows.map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join('')}</div>
      ${payNote}
      ${BK.error ? `<div class="notice err" role="alert" style="margin-bottom:14px">${I.info}<span>${esc(BK.error)}</span></div>` : ''}
      <div class="nav-row"><button class="btn btn-quiet" type="button" data-act="bk-back">${I.left}Atrás</button>
      ${BK.error ? `<button class="btn btn-ghost" type="button" data-act="bk-repick">Elegir otra ${BK.mode === 'class' ? 'clase' : 'hora'}</button>` : ''}
      <button class="btn btn-brand" type="button" data-act="bk-confirm" ${BK.busy ? 'disabled' : ''}>${btn}</button></div>`;
  }

  function stepDone() {
    const r = BK.result;
    const rows = summaryRows().slice(1).filter(x => x[0] !== 'Plazas libres');
    const confirmed = BK.mode === 'class' || (r.appointment && r.appointment.status === 'confirmada');
    return `<div class="done"><span class="tick">${I.check}</span>
      <h2 class="h3" id="bk-step-title" tabindex="-1" style="font-family:var(--f-display);font-size:2rem">${BK.mode === 'class' ? '¡Plaza reservada!' : confirmed ? '¡Cita confirmada!' : 'Hemos recibido tu solicitud'}</h2>
      <div class="review" style="width:100%">${rows.map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join('')}</div>
      ${BK.form.whatsappOptIn && API.mode !== 'demo' ? `<div class="notice ok" style="width:100%">${I.whatsapp}<span>Te enviaremos la confirmación y un recordatorio por WhatsApp.</span></div>` : ''}
      <div class="notice" style="width:100%">${I.info}<span>Guarda este enlace para cambiar o cancelar la cita: <a href="${esc(r.manageUrl)}">gestionar mi cita</a>.</span></div>
      ${API.mode === 'demo' ? `<div class="notice warn" style="width:100%">${I.info}<span>Demo: no se ha enviado al centro ni se ha enviado ningún mensaje. Ya aparece en el Área profesional.</span></div>` : ''}
      <div class="acts"><a class="btn btn-primary" href="index.html">Volver al inicio</a><button class="btn btn-ghost" type="button" data-act="bk-again">Hacer otra reserva</button></div></div>`;
  }

  function body() {
    if (BK.result) return stepDone();
    if (BK.mode === 'class') return [null, stepClass, stepData, stepReview][BK.step]();
    return [null, stepService, stepSpecialist, stepCalendar, stepData, stepReview][BK.step]();
  }

  let lastKey = '';
  function render(focus) {
    if (!BK.cfg) { root.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando…</div>'; return; }
    const key = `${BK.mode}-${BK.step}-${!!BK.result}`;
    const tabs = BK.result || !CLS ? '' : `<div class="bk-tabs" role="group" aria-label="Tipo de reserva"><button type="button" data-act="bk-mode" data-v="individual" aria-pressed="${BK.mode === 'individual'}">Cita individual</button>${CLS ? `<button type="button" data-act="bk-mode" data-v="class" aria-pressed="${BK.mode === 'class'}">Clase de ${esc(CLS.nombre)}</button>` : ''}</div>`;
    root.innerHTML = `${tabs}<div class="bk-shell">${stepper()}<div class="modal-body"><div class="modal-main">${body()}</div>${side()}</div></div>`;
    if (key !== lastKey || focus) { const t = $('#bk-step-title'); if (t && lastKey) { t.focus({ preventScroll: true }); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
    lastKey = key;
    const form = $('#bk-form');
    if (form) form.addEventListener('submit', ev => {
      ev.preventDefault();
      if (validate()) { BK.step += 1; BK.error = null; render(); }
      else { render(); const bad = root.querySelector('[aria-invalid="true"]'); if (bad) bad.focus(); }
    });
  }

  document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.bk; if (k) BK.form[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; });
  document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.bk; if (k && e.target.type === 'checkbox') BK.form[k] = e.target.checked; });

  /* ---------- acciones ---------- */
  actions['bk-mode'] = el => {
    BK.mode = el.dataset.v; BK.step = 1; BK.error = null; BK.result = null;
    if (BK.mode === 'class') loadClasses();
    else if (el.dataset.svc) { BK.serviceId = el.dataset.svc; enterSpecialists(); }
    else render();
  };
  actions['bk-service'] = el => { BK.serviceId = el.dataset.id; BK.error = null; const l = spsFor(BK.serviceId); if (l.length === 1) { BK.specialistId = l[0].id; enterCalendar(); } else enterSpecialists(); };
  actions['bk-sp'] = el => { BK.specialistId = el.dataset.id; enterCalendar(); };
  actions['bk-quick'] = el => { BK.specialistId = el.dataset.sp; BK.date = el.dataset.date; BK.start = el.dataset.start; BK.month = BK.date.slice(0, 7); BK.step = 4; render(); };
  actions['bk-day'] = el => { BK.date = el.dataset.date; BK.start = null; loadDay(); };
  actions['bk-slot'] = el => { BK.start = el.dataset.start; render(); };
  actions['bk-month'] = el => {
    const [y, m] = BK.month.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
    BK.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    BK.date = null; BK.start = null; BK.slots = null;
    loadMonth();
  };
  actions['bk-next'] = () => { if (BK.start) { BK.step = 4; render(); } };
  actions['bk-back'] = () => {
    BK.error = null;
    if (BK.mode === 'class') { BK.step = Math.max(1, BK.step - 1); if (BK.step === 1) loadClasses(); else render(); return; }
    if (BK.step === 3) { if (spsFor(BK.serviceId).length === 1) { BK.step = 1; render(); } else enterSpecialists(); return; }
    if (BK.step === 4 && BK.specialistId) { enterCalendar(BK.date); return; }
    BK.step = Math.max(1, BK.step - 1); render();
  };
  actions['bk-repick'] = () => { BK.error = null; if (BK.mode === 'class') { BK.step = 1; BK.session = null; loadClasses(); } else enterCalendar(BK.date); };
  actions['bk-ctype'] = el => { BK.classType = el.dataset.type; render(); };
  actions['bk-cweek'] = el => { BK.classWeek = Math.max(0, Math.min(3, BK.classWeek + Number(el.dataset.d))); loadClasses(); };
  actions['bk-class'] = el => { BK.session = BK.sessions.find(s => s.slotId === el.dataset.slot && s.date === el.dataset.date); BK.step = 2; render(); };
  actions['bk-again'] = () => { BK.result = null; BK.step = 1; BK.serviceId = null; BK.specialistId = null; BK.date = null; BK.start = null; BK.session = null; if (BK.mode === 'class') loadClasses(); else render(); };
  actions['bk-confirm'] = async () => {
    if (BK.busy) return;
    BK.busy = true; BK.error = null; render();
    const f = BK.form;
    const person = { name: f.name, phone: f.phone, email: f.email, whatsappOptIn: f.whatsappOptIn, privacyAccepted: f.privacy, website: f.website, source: qp().get('origen') === 'asistente' ? 'chatbot' : 'web' };
    try {
      BK.result = BK.mode === 'class'
        ? await API.bookClass({ slotId: BK.session.slotId, date: BK.session.date, ...person })
        : await API.book({ serviceId: BK.serviceId, specialistId: BK.specialistId, date: BK.date, start: BK.start, ...person });
      // Con señal: se va a la página de pago de Stripe; al volver, cita.html muestra el resultado.
      if (BK.result && BK.result.checkoutUrl) { window.location.assign(BK.result.checkoutUrl); return; }
    } catch (e) { BK.error = e.message; BK.result = null; }
    BK.busy = false; render(true);
  };

  /* ---------- inicio: admite enlaces con servicio, especialista, fecha y hora ---------- */
  async function start() {
    render();
    try { BK.cfg = await API.config(); } catch (e) { root.innerHTML = `<div class="notice err">${I.info}<span>${esc(e.message)}</span></div>`; return; }
    const p = qp();
    const svcId = p.get('servicio'), spId = p.get('especialista'), date = p.get('fecha'), hora = p.get('hora'), clase = p.get('clase');
    if (CLS && (clase || p.get('modo') === 'clase')) {
      BK.mode = 'class';
      if (clase && date) {
        const mon = mondayOf(date);
        BK.classWeek = Math.max(0, Math.round((new Date(mon) - new Date(mondayOf(window.UI.today))) / 6048e5));
        await loadClasses();
        const s = (BK.sessions || []).find(x => x.slotId === clase && x.date === date);
        if (s && !s.full && !s.past) { BK.session = s; BK.step = 2; }
        render();
      } else loadClasses();
      return;
    }
    if (svcId && BK.cfg.services.some(s => s.id === svcId)) {
      BK.serviceId = svcId;
      const list = spsFor(svcId);
      const sp = spId && list.find(s => s.id === spId);
      if (sp && date && hora) { BK.specialistId = sp.id; BK.date = date; BK.start = hora; BK.month = date.slice(0, 7); BK.step = 4; render(); return; }
      if (sp || list.length === 1) { BK.specialistId = (sp || list[0]).id; enterCalendar(date || null); return; }
      enterSpecialists(); return;
    }
    if (spId) {
      const sp = spOf(spId);
      if (sp && sp.serviceIds.length === 1) { BK.serviceId = sp.serviceIds[0]; BK.specialistId = sp.id; enterCalendar(); return; }
    }
    render();
  }
  // Si vuelve atrás desde la página de pago, el formulario no se queda bloqueado.
  window.addEventListener('pageshow', e => { if (e.persisted && BK.busy) { BK.busy = false; BK.result = null; render(); } });
  start();
})();
