/* ---------- Área profesional (panel interno) ---------- */
(function () {
  'use strict';
  const { S, U, esc, $, $$, today, fmtDay, cap, monthLabel, endTime, I, avatar, spColor, statusBadge, toast, actions } = window.APP;

  const P = {
    view: 'dashboard', agView: 'week', agDate: today(), fSp: 'all', fSvc: 'all', fSt: 'all',
    spSel: null, spWeek: U.mondayOf(today()), drawer: null, confirm: null, ptSearch: '', ptFilter: 'all',
    clsWeek: 0, highlight: null, week: { key: null, data: null }, googleAccount: null, calendars: null
  };
  const NAV = [
    ['dashboard', 'Dashboard', I.dash], ['agenda', 'Agenda', I.agenda], ['especialistas', 'Especialistas', I.staff],
    ['pacientes', 'Pacientes', I.users], ['servicios', 'Servicios', I.list], ['horarios', 'Horarios y disponibilidad', I.hours], ['config', 'Configuración', I.gear]
  ];
  const nowStamp = () => { const n = new Date(); return U.dk(n) + ' ' + U.fmt(n.getHours() * 60 + n.getMinutes()); };
  const live = b => b.status !== 'cancelada';
  const spName = id => (S.getSpecialist(id) || { name: 'Especialista eliminado' }).name;
  const svcName = id => (S.getService(id) || { name: 'Servicio' }).name;
  const ptName = id => (S.getPatient(id) || { name: 'Paciente eliminado' }).name;
  const srcLabel = s => ({ web: 'Web', chatbot: 'Asistente web', panel: 'Panel' }[s] || s);
  const evStyle = sp => `background:color-mix(in srgb, ${spColor(sp)} 16%, var(--surface));border-left-color:${spColor(sp)};color:var(--ink)`;

  function filtered() {
    return S.state.bookings.filter(b => (P.fSp === 'all' || b.specialistId === P.fSp) && (P.fSvc === 'all' || b.serviceId === P.fSvc) && (P.fSt === 'all' || b.status === P.fSt));
  }

  /* ---------- esqueleto ---------- */
  function render() {
    if (!P.spSel || !S.getSpecialist(P.spSel)) P.spSel = (S.state.specialists[0] || {}).id;
    const pend = S.state.bookings.filter(b => b.status === 'pendiente' && b.date >= today()).length;
    const root = $('#panel');
    const scrollY = window.scrollY;
    const side = `<aside class="side" aria-label="Navegación del panel">
      <div class="brand"><div><span class="logo-img" role="img" aria-label="${esc((window.SITIO && window.SITIO.negocio.nombreCorto) || '')}" style="width:104px;color:var(--on-navy)"></span><span style="display:block;margin-top:8px">Área profesional</span></div></div>
      <span class="side-label">Gestión</span>
      ${NAV.map(([id, label, ic]) => `<button class="side-btn" type="button" data-act="pv" data-v="${id}" ${P.view === id ? 'aria-current="page"' : ''}>${ic}<span>${label}</span>${id === 'agenda' && pend ? `<span class="count" aria-label="${pend} pendientes">${pend}</span>` : ''}</button>`).join('')}
      <div class="side-foot"><p>${S.mode === 'demo' ? 'Demo: datos ficticios guardados en este navegador.' : `Sesión: ${esc((S.user() || {}).name || '')}`}</p><a class="side-btn" href="../index.html">${I.out}<span>Ver la web</span></a>${S.mode === 'demo' ? '' : `<button class="side-btn" type="button" data-act="logout">${I.lock}<span>Cerrar sesión</span></button>`}</div>
    </aside>`;
    const views = { dashboard: vDashboard, agenda: vAgenda, especialistas: vSpecialists, pacientes: vPatients, servicios: vServices, horarios: vHours, config: vConfig };
    root.innerHTML = `<div class="app">${side}<main class="main" id="pmain">${views[P.view]()}</main></div><div id="drawer-root"></div>`;
    window.scrollTo(0, scrollY);
    renderDrawer();
  }

  function topbar(title, sub, tools) {
    return `<div class="topbar"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="tools">${tools || ''}</div></div>`;
  }

  /* ---------- Dashboard ---------- */
  function vDashboard() {
    const st = S.state, t = today(), stamp = nowStamp();
    const todays = st.bookings.filter(b => b.date === t && live(b));
    const in7 = U.addDays(t, 7), in30 = U.addDays(t, 30), ago30 = U.addDays(t, -30);
    const upcoming = st.bookings.filter(b => live(b) && b.status !== 'completada' && (b.date + ' ' + b.start) >= stamp).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const next7 = upcoming.filter(b => b.date < in7);
    const pending = upcoming.filter(b => b.status === 'pendiente');
    const clsToday = S.classSessions(t);
    const seatsToday = clsToday.reduce((n, s) => n + s.taken, 0);
    const bySp = st.specialists.map(sp => ({ sp, n: st.bookings.filter(b => b.specialistId === sp.id && live(b) && b.date >= t && b.date <= in30).length }));
    const maxSp = Math.max(1, ...bySp.map(x => x.n));
    const bySvc = st.services.map(s => ({ s, n: st.bookings.filter(b => b.serviceId === s.id && live(b) && b.date >= ago30 && b.date <= in30).length })).sort((a, b) => b.n - a.n);
    const maxSvc = Math.max(1, ...bySvc.map(x => x.n));
    const fromWeb = st.bookings.filter(b => (b.source === 'web' || b.source === 'chatbot') && b.date >= ago30).length;
    return topbar('Dashboard', cap(fmtDay(t, 'full')), `<button class="btn btn-primary btn-sm" type="button" data-act="new-booking">${I.plus}Nueva cita</button>`) + `
      <div class="kpis">
        <div class="kpi"><span>Citas de hoy</span><b>${todays.length}</b><small>${seatsToday} plazas ocupadas en ${clsToday.length} clases</small></div>
        <div class="kpi"><span>Próximos 7 días</span><b>${next7.length}</b><small>citas individuales</small></div>
        <div class="kpi ${pending.length ? 'attn' : ''}"><span>Pendientes de confirmar</span><b>${pending.length}</b><small>solicitudes desde la web</small></div>
        <div class="kpi"><span>Pacientes registrados</span><b>${st.patients.length}</b><small>${fromWeb} reservas online en 30 días</small></div>
      </div>
      <div class="dash">
        <div style="display:grid;gap:16px;align-content:start;min-width:0">
          ${pending.length ? `<section class="panel"><div class="panel-head"><h3>Solicitudes pendientes de confirmar</h3><span>Llegan desde la web y el asistente</span></div><div class="appt-list">${pending.slice(0, 6).map(b => apptRow(b, true)).join('')}</div></section>` : ''}
          <section class="panel"><div class="panel-head"><h3>Próximas citas</h3><button class="btn btn-quiet btn-sm" type="button" data-act="pv" data-v="agenda">Abrir agenda ${I.arrow}</button></div>
            <div class="appt-list">${upcoming.slice(0, 8).map(b => apptRow(b)).join('') || '<p class="empty" style="margin:14px">No hay citas próximas.</p>'}</div></section>
          <section class="panel"><div class="panel-head"><h3>Actividad reciente</h3><span>Web, asistente y panel</span></div>
            <ul class="activity">${st.log.slice(0, 8).map(l => { const d = new Date(l.ts); return `<li><time class="mono">${U.fmt(d.getHours() * 60 + d.getMinutes())}</time><span>${esc(l.text)}</span></li>`; }).join('')}</ul></section>
        </div>
        <div style="display:grid;gap:16px;align-content:start;min-width:0">
          <section class="panel"><div class="panel-head"><h3>Citas por especialista</h3><span>Próximos 30 días</span></div><div class="panel-body bars">
            ${bySp.map(x => `<div class="bar-row"><span class="nm">${esc(x.sp.name)}</span><span class="bar-track"><i style="width:${Math.round(x.n / maxSp * 100)}%;background:${spColor(x.sp)}"></i></span><span class="v">${x.n}</span></div>`).join('')}</div></section>
          <section class="panel"><div class="panel-head"><h3>Servicios más solicitados</h3><span>±30 días</span></div><div class="panel-body bars">
            ${bySvc.map(x => `<div class="bar-row"><span class="nm">${esc(x.s.name)}</span><span class="bar-track"><i style="width:${Math.round(x.n / maxSvc * 100)}%;background:var(--sage)"></i></span><span class="v">${x.n}</span></div>`).join('')}</div></section>
          <section class="panel"><div class="panel-head"><h3>Clases de hoy</h3><button class="btn btn-quiet btn-sm" type="button" data-act="pv" data-v="horarios">Gestionar</button></div><div class="panel-body cls-mini">
            ${clsToday.map(s => `<div><span class="mono">${s.template.start}</span><span>${esc(s.type.name)}<span class="seatbar" style="display:block;margin-top:4px"><i style="width:${s.capacity ? s.taken / s.capacity * 100 : 0}%;${s.full ? 'background:var(--danger)' : ''}"></i></span></span><span class="mono" style="text-align:right">${s.taken}/${s.capacity}</span></div>`).join('') || '<p class="empty">Hoy no hay clases programadas.</p>'}</div></section>
        </div>
      </div>`;
  }

  function apptRow(b, withConfirm) {
    const sp = S.getSpecialist(b.specialistId);
    const main = `<span class="when">${b.start}<small>${b.date === today() ? 'hoy' : fmtDay(b.date)}</small></span>
      <span class="who"><b>${esc(ptName(b.patientId))}</b><span><i class="sp-dot" style="background:${spColor(sp)}"></i>${esc(svcName(b.serviceId))} · ${esc(spName(b.specialistId))}</span></span>`;
    if (withConfirm) return `<div class="appt"><button type="button" data-act="open-booking" data-id="${b.id}" style="display:contents;font:inherit;color:inherit;text-align:left;background:none;border:0">${main}</button><span style="display:flex;gap:6px"><button class="btn btn-sage btn-sm" type="button" data-act="bk-status" data-id="${b.id}" data-st="confirmada">Confirmar</button></span></div>`;
    return `<button class="appt" type="button" data-act="open-booking" data-id="${b.id}">${main}${statusBadge(b.status)}</button>`;
  }

  /* ---------- Agenda ---------- */
  function vAgenda() {
    const st = S.state;
    const seg = [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['sp', 'Por especialista']].map(([v, l]) => `<button type="button" data-act="ag-view" data-v="${v}" aria-pressed="${P.agView === v}">${l}</button>`).join('');
    let label;
    if (P.agView === 'day') label = cap(fmtDay(P.agDate, 'full'));
    else if (P.agView === 'month') label = cap(monthLabel(P.agDate.slice(0, 7)));
    else { const m = U.mondayOf(P.agView === 'sp' ? P.spWeek : P.agDate); label = `Semana del ${fmtDay(m, 'num')} al ${fmtDay(U.addDays(m, 6), 'num')}`; }
    const filters = P.agView === 'sp' ? '' : `<div class="filters">
      <label class="sr-only" for="f-sp">Especialista</label><select class="input" id="f-sp" data-pf="fSp"><option value="all">Todos los especialistas</option>${st.specialists.map(s => `<option value="${s.id}" ${P.fSp === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <label class="sr-only" for="f-svc">Servicio</label><select class="input" id="f-svc" data-pf="fSvc"><option value="all">Todos los servicios</option>${st.services.map(s => `<option value="${s.id}" ${P.fSvc === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <label class="sr-only" for="f-st">Estado</label><select class="input" id="f-st" data-pf="fSt"><option value="all">Todos los estados</option>${Object.entries(U.STATUS).map(([k, v]) => `<option value="${k}" ${P.fSt === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>`;
    const legend = `<div class="filters" style="margin-bottom:12px;font-size:.8rem;color:var(--ink-2)">${st.specialists.map(s => `<span style="display:inline-flex;gap:6px;align-items:center"><i class="sp-dot" style="background:${spColor(s)}"></i>${esc(s.name)}</span>`).join('')}</div>`;
    const body = { day: agDay, week: agWeek, month: agMonth, sp: agSpecialist }[P.agView]();
    return topbar('Agenda', 'Citas individuales de todo el equipo en un mismo lugar', `<button class="btn btn-primary btn-sm" type="button" data-act="new-booking">${I.plus}Nueva cita</button>`) + `
      <div class="toolbar"><div class="seg" role="group" aria-label="Vista">${seg}</div>
        <div class="week-nav"><button class="icon-btn" type="button" data-act="ag-nav" data-d="-1" aria-label="Anterior">${I.left}</button><button class="btn btn-ghost btn-sm" type="button" data-act="ag-today">Hoy</button><button class="icon-btn" type="button" data-act="ag-nav" data-d="1" aria-label="Siguiente">${I.right}</button></div>
        <b style="font-size:.95rem">${label}</b>
        <span class="grow"></span>
        <label class="sr-only" for="ag-jump">Ir a fecha</label><input class="input" type="date" id="ag-jump" data-pf="jump" value="${P.agView === 'sp' ? P.spWeek : P.agDate}" style="min-width:0">
      </div>
      ${filters}${P.agView === 'sp' ? '' : legend}${body}`;
  }

  const DAY_START = 8 * 60, DAY_END = 21 * 60, PX = 1.15; // px por minuto
  function agDay() {
    const st = S.state, d = P.agDate;
    const sps = st.specialists.filter(s => P.fSp === 'all' || s.id === P.fSp);
    const list = filtered().filter(b => b.date === d);
    const H = (DAY_END - DAY_START) * PX;
    const y = m => (m - DAY_START) * PX;
    let lines = '';
    for (let m = DAY_START; m <= DAY_END; m += 30) lines += `<div class="dv-line ${m % 60 ? 'half' : ''}" style="top:${y(m)}px"></div>`;
    let times = '';
    for (let m = DAY_START; m < DAY_END; m += 60) times += `<span style="top:${y(m) + 1}px">${U.fmt(m)}</span>`;
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    const nowLine = d === today() && nm >= DAY_START && nm <= DAY_END ? `<div class="now-line" style="top:${y(nm)}px"></div>` : '';
    const cols = sps.map(sp => {
      const plan = S.dayPlan(sp, d);
      let shade = '';
      if (!plan.working) shade = `<div class="dv-off" style="top:0;height:${H}px;display:grid;place-items:center"><span class="badge badge-muted">${plan.reason === 'vacation' ? esc(plan.label) : plan.reason === 'inactive' ? 'Agenda desactivada' : 'No trabaja'}</span></div>`;
      else {
        let cur = DAY_START;
        plan.blocks.slice().sort((a, b) => a[0] - b[0]).forEach(([s, e]) => { if (s > cur) shade += `<div class="dv-off" style="top:${y(cur)}px;height:${(s - cur) * PX}px"></div>`; cur = Math.max(cur, e); });
        if (cur < DAY_END) shade += `<div class="dv-off" style="top:${y(cur)}px;height:${(DAY_END - cur) * PX}px"></div>`;
        plan.breaks.forEach(([s, e]) => { shade += `<div class="dv-break" style="top:${y(s)}px;height:${(e - s) * PX}px">Descanso</div>`; });
      }
      const evs = list.filter(b => b.specialistId === sp.id).map(b => {
        const s = U.tmin(b.start);
        return `<button type="button" class="ev ${b.status}" data-act="open-booking" data-id="${b.id}" style="top:${y(s) + 1}px;height:${Math.max(22, b.duration * PX - 2)}px;${evStyle(sp)}${P.highlight === b.id ? ';box-shadow:0 0 0 2px var(--ink)' : ''}" aria-label="${b.start}, ${esc(ptName(b.patientId))}, ${esc(svcName(b.serviceId))}, ${U.STATUS[b.status]}">
          <b>${b.start} · ${esc(ptName(b.patientId))}</b><span>${esc(svcName(b.serviceId))} · ${U.STATUS[b.status]}</span></button>`;
      }).join('');
      return `<div class="dv-col" style="height:${H}px">${shade}${lines}${evs}${nowLine}</div>`;
    }).join('');
    const head = `<div></div>${sps.map(sp => `<div>${avatar(sp, 'xs')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sp.name)}</span></div>`).join('')}`;
    return `<div class="cal-scroll"><div class="dayview" style="grid-template-columns:56px repeat(${sps.length}, minmax(150px, 1fr));min-width:${56 + sps.length * 150}px">
      <div class="dv-head">${head}</div>
      <div class="dv-times" style="height:${H}px">${times}</div>${cols}</div></div>`;
  }

  function agWeek() {
    const mon = U.mondayOf(P.agDate);
    const list = filtered();
    const cols = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const d = U.addDays(mon, i);
      const evs = list.filter(b => b.date === d).sort((a, b) => a.start.localeCompare(b.start));
      const cls = S.classSessions(d);
      const seats = cls.reduce((n, s) => n + s.taken, 0);
      return `<div class="wv-col ${d === today() ? 'today' : ''}"><h4><button type="button" data-act="ag-goday" data-d="${d}" style="background:none;border:0;padding:0;font:inherit;text-transform:capitalize">${fmtDay(d)}</button><span>${evs.filter(live).length}</span></h4><div class="wv-list">
        ${evs.map(b => { const sp = S.getSpecialist(b.specialistId); return `<button type="button" class="wv-ev ${b.status}" data-act="open-booking" data-id="${b.id}" style="${evStyle(sp)}"><span class="mono">${b.start}–${endTime(b.start, b.duration)}</span><b>${esc(ptName(b.patientId))}</b><span>${esc(svcName(b.serviceId))} · ${esc(spName(b.specialistId))}</span></button>`; }).join('') || '<span style="font-size:.75rem;color:var(--ink-3);padding:6px">Sin citas</span>'}
        ${cls.length ? `<div class="wv-cls"><span>${cls.length} clases</span><span class="mono">${seats} plazas</span></div>` : ''}
      </div></div>`;
    }).join('');
    return `<p style="font-size:.78rem;color:var(--ink-3);margin-bottom:8px">Rayado: pendiente de confirmar · Tachado: cancelada</p><div class="cal-scroll"><div class="weekview">${cols}</div></div>`;
  }

  function agMonth() {
    const ym = P.agDate.slice(0, 7);
    const first = `${ym}-01`;
    const start = U.mondayOf(first);
    const list = filtered();
    let cells = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="mv-dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = U.addDays(start, i);
      if (i >= 35 && d.slice(0, 7) !== ym) break;
      const evs = list.filter(b => b.date === d && live(b)).sort((a, b) => a.start.localeCompare(b.start));
      cells += `<button type="button" class="mv-day ${d.slice(0, 7) !== ym ? 'other' : ''} ${d === today() ? 'today' : ''}" data-act="ag-goday" data-d="${d}" aria-label="${cap(fmtDay(d, 'long'))}: ${evs.length} citas"><span class="n">${Number(d.slice(8))}</span>
        ${evs.slice(0, 3).map(b => { const sp = S.getSpecialist(b.specialistId); return `<span class="mv-pill" style="${evStyle(sp)}">${b.start} ${esc(ptName(b.patientId).split(' ')[0])}</span>`; }).join('')}
        ${evs.length > 3 ? `<span class="mv-more">+${evs.length - 3} más</span>` : ''}</button>`;
    }
    return `<div class="cal-scroll"><div class="monthview">${cells}</div></div>`;
  }

  function weekHoursText(sp, d) {
    const day = sp.schedule[d];
    if (!day || !day.on || !day.blocks.length) return '—';
    return day.blocks.filter(b => b.s && b.e).map(b => `${b.s}–${b.e}`).join(' / ');
  }

  function agSpecialist() {
    const st = S.state;
    const sp = S.getSpecialist(P.spSel);
    const mon = U.mondayOf(P.spWeek);
    const sw = `<div class="sp-switch" role="group" aria-label="Elegir especialista">${st.specialists.map(s => `<button type="button" data-act="sp-sel" data-id="${s.id}" aria-pressed="${s.id === P.spSel}">${avatar(s, 'xs')}${esc(s.name)}</button>`).join('')}</div>`;
    if (!sp) return sw + '<p class="empty">No hay especialistas.</p>';
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => U.addDays(mon, i));
    const key = `${sp.id}|${mon}`;
    if (P.week.key !== key) {
      P.week = { key, data: null };
      S.weekGrid(sp.id, mon).then(days => { if (P.week.key === key) { P.week.data = days; if (P.view === 'agenda' && P.agView === 'sp') rerenderMain(); } })
        .catch(e => { if (P.week.key === key) { P.week.data = []; toast(e.message, 'err'); } });
    }
    if (!P.week.data) return sw + `<div class="loading"><span class="spinner"></span>Cargando la agenda de ${esc(sp.name)}…</div>`;
    const data = P.week.data.map(x => ({ d: x.date, plan: x.plan, slots: x.slots }));
    const times = Array.from(new Set(data.flatMap(x => x.slots.map(s => s.min)))).sort((a, b) => a - b);
    const svcs = sp.serviceIds.map(id => S.getService(id)).filter(Boolean);
    const vac = (sp.vacations || []).filter(v => v.to >= today());
    let grid = `<div class="spv-h"></div>${data.map(x => `<div class="spv-h ${x.d === today() ? 'today' : ''}">${fmtDay(x.d)}</div>`).join('')}`;
    const counts = { available: 0, booked: 0 };
    times.forEach(t => {
      grid += `<div class="spv-t">${U.fmt(t)}</div>`;
      data.forEach(x => {
        let cell;
        if (!x.plan.working) cell = x.plan.reason === 'vacation' ? `<div class="cell vac">${t === times[0] ? esc(x.plan.label) : ''}</div>` : `<div class="cell off">${t === times[0] ? 'No trabaja' : ''}</div>`;
        else {
          const s = x.slots.find(z => z.min === t);
          if (!s) cell = '<div class="cell off"></div>';
          else if (s.status === 'available') { counts.available++; cell = `<button type="button" class="cell available" data-act="new-booking" data-sp="${sp.id}" data-date="${x.d}" data-start="${s.start}" aria-label="${fmtDay(x.d, 'long')} ${s.start}: disponible, crear cita">Disponible</button>`; }
          else if (s.status === 'booked' && s.bookingId) { counts.booked++; const bk = S.state.bookings.find(b => b.id === s.bookingId); const pn = bk ? ptName(bk.patientId) : 'Cita'; cell = `<button type="button" class="cell booked" data-act="open-booking" data-id="${s.bookingId}" aria-label="${fmtDay(x.d, 'long')} ${s.start}: reservado por ${esc(pn)}"><b>Reservado</b>${esc(pn.split(' ')[0])}</button>`; }
          else if (s.status === 'booked') { counts.booked++; cell = `<div class="cell booked" title="Ocupado en su Google Calendar"><b>Ocupado</b>Google</div>`; }
          else if (s.status === 'break') cell = '<div class="cell break">Descanso</div>';
          else if (s.status === 'past') cell = '<div class="cell past">Pasado</div>';
          else cell = '<div class="cell unavailable">No disponible</div>';
        }
        grid += `<div class="spv-c">${cell}</div>`;
      });
    });
    return sw + `<div class="sp-summary">${avatar(sp, 'sm')}<span><b>${esc(sp.name)}</b> · ${esc(sp.role)}</span>
      <span>Franjas de <b>${sp.slotStep} min</b></span><span>Servicios: <b>${svcs.map(s => esc(s.name)).join(', ') || '—'}</b></span>
      <span>Esta semana: <b>${counts.available}</b> huecos libres · <b>${counts.booked}</b> ocupados</span>
      ${vac.length ? `<span class="badge badge-demo">Vacaciones: ${vac.map(v => `${fmtDay(v.from)}–${fmtDay(v.to)}`).join(', ')}</span>` : ''}
      ${sp.active ? '' : '<span class="badge st-cancelada" style="text-decoration:none">Agenda desactivada</span>'}
      <button class="btn btn-ghost btn-sm" type="button" data-act="edit-sp" data-id="${sp.id}" style="margin-left:auto">Editar horario</button></div>
      <div class="filters" style="margin-bottom:10px;font-size:.78rem;color:var(--ink-2)">${[1, 2, 3, 4, 5, 6, 7].map(d => `<span><b>${U.DAY_SHORT[d]}</b> ${weekHoursText(sp, d)}</span>`).join(' · ')}</div>
      ${times.length ? `<div class="cal-scroll"><div class="spv">${grid}</div></div>` : '<p class="empty">Este especialista no tiene horas de trabajo esta semana.</p>'}`;
  }

  /* ---------- Especialistas ---------- */
  function vSpecialists() {
    const st = S.state;
    return topbar('Especialistas', 'Ficha, servicios y horario de cada profesional. Los cambios se aplican al momento en la web pública.', `<button class="btn btn-primary btn-sm" type="button" data-act="edit-sp" data-id="">${I.plus}Añadir especialista</button>`) + `
      <div class="cards">${st.specialists.map(sp => {
        const svcs = sp.serviceIds.map(id => S.getService(id)).filter(Boolean);
        const nx = svcs[0] ? S.nextAvailable(sp.id, svcs[0].id, 1)[0] : null;
        return `<article class="sp-card ${sp.active ? '' : 'inactive'}">
          <div class="top">${avatar(sp)}<div><h3>${esc(sp.name)}</h3><p class="role">${esc(sp.role)}</p><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${sp.demo ? '<span class="badge badge-demo">Perfil demo</span>' : '<span class="badge badge-real">Dato real</span>'}${sp.exampleSchedule ? '<span class="badge badge-muted">Horario de ejemplo</span>' : ''}</div></div></div>
          <div class="week-strip" aria-label="Días de trabajo">${[1, 2, 3, 4, 5, 6, 7].map(d => { const day = sp.schedule[d]; const on = day && day.on && day.blocks.length; return `<div class="${on ? 'on' : ''}" title="${U.DAY_NAMES[d]}: ${weekHoursText(sp, d)}">${U.DAY_SHORT[d]}</div>`; }).join('')}</div>
          <p style="font-size:.8rem;color:var(--ink-2)">${svcs.map(s => esc(s.name)).join(' · ') || 'Sin servicios asignados'}</p>
          <p style="font-size:.8rem;color:var(--ink-3)">Franjas de ${sp.slotStep} min · ${nx ? `próximo hueco ${fmtDay(nx.date)} ${nx.start}` : 'sin huecos próximos'}</p>
          <div class="row"><label class="toggle"><input type="checkbox" data-act="sp-toggle" data-id="${sp.id}" ${sp.active ? 'checked' : ''} aria-label="Agenda disponible para reservas">${sp.active ? 'Disponible para reservas' : 'Desactivado'}</label>
          <span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="sp-agenda" data-id="${sp.id}">Agenda</button><button class="btn btn-primary btn-sm" type="button" data-act="edit-sp" data-id="${sp.id}">Editar</button></span></div>
        </article>`;
      }).join('')}</div>`;
  }

  /* ---------- Pacientes ---------- */
  function patientRows() {
    const q = U.norm(P.ptSearch);
    return S.state.patients.map(p => ({ p, s: S.patientStats(p.id) }))
      .filter(({ p, s }) => (!q || U.norm(p.name + ' ' + p.email + ' ' + p.phone).includes(q)) &&
        (P.ptFilter === 'all' || (P.ptFilter === 'next' && s.next) || (P.ptFilter === 'none' && !s.next) || (P.ptFilter === 'class' && s.items.some(i => i.kind === 'class'))))
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
  }
  function patientTbody() {
    const rows = patientRows();
    const nx = i => i ? `${fmtDay(i.date)} · ${i.start}${i.kind === 'class' ? ' · clase' : ''}` : '—';
    return rows.map(({ p, s }) => `<tr data-act="open-patient" data-id="${p.id}" tabindex="0" role="button" aria-label="Abrir ficha de ${esc(p.name)}"><td><b>${esc(p.name)}</b></td><td class="mono">${esc(p.phone)}</td><td>${esc(p.email)}</td><td class="mono ${s.next ? '' : 'muted'}">${nx(s.next)}</td><td class="mono ${s.last ? '' : 'muted'}">${s.last ? fmtDay(s.last.date) : '—'}</td><td class="mono">${s.count}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin resultados para esta búsqueda.</td></tr>';
  }
  function vPatients() {
    return topbar('Pacientes', `${S.state.patients.length} pacientes ficticios · gestión de citas, sin historia clínica`, `<button class="btn btn-primary btn-sm" type="button" data-act="edit-pt" data-id="">${I.plus}Nuevo paciente</button>`) + `
      <div class="toolbar"><label class="sr-only" for="pt-q">Buscar paciente</label><input class="input" id="pt-q" data-pf="ptSearch" type="search" placeholder="Buscar por nombre, teléfono o correo" value="${esc(P.ptSearch)}" style="min-width:min(100%, 300px)">
      <label class="sr-only" for="pt-f">Filtro</label><select class="input" id="pt-f" data-pf="ptFilter">${[['all', 'Todos'], ['next', 'Con próxima cita'], ['none', 'Sin citas futuras'], ['class', 'Asisten a clases']].map(([v, l]) => `<option value="${v}" ${P.ptFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Próxima cita</th><th>Última visita</th><th>Reservas</th></tr></thead><tbody id="pt-body">${patientTbody()}</tbody></table></div>`;
  }

  /* ---------- Servicios ---------- */
  function vServices() {
    const st = S.state, t = today();
    return topbar('Servicios', 'Catálogo de citas individuales que se pueden reservar online', `<button class="btn btn-primary btn-sm" type="button" data-act="edit-svc" data-id="">${I.plus}Añadir servicio</button>`) + `
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Servicio</th><th>Duración</th><th>Especialistas</th><th>Precio orientativo</th><th>Próximas citas</th><th>Estado</th></tr></thead><tbody>
      ${st.services.map(s => { const sps = st.specialists.filter(sp => sp.serviceIds.includes(s.id)); const n = st.bookings.filter(b => b.serviceId === s.id && live(b) && b.date >= t).length;
        return `<tr data-act="edit-svc" data-id="${s.id}" tabindex="0" role="button" aria-label="Editar ${esc(s.name)}"><td><b>${esc(s.name)}</b><br><span style="font-size:.8rem;color:var(--ink-3)">${esc(s.short)}</span></td><td class="mono">${s.duration} min</td><td><span style="display:flex;gap:4px;flex-wrap:wrap">${sps.map(sp => avatar(sp, 'xs')).join('') || '<span class="muted">—</span>'}</span></td><td class="${s.price == null ? 'muted' : 'mono'}">${s.price == null ? 'A consultar' : s.price + ' € (demo)'}</td><td class="mono">${n}</td><td>${s.active ? '<span class="badge st-confirmada">Activo</span>' : '<span class="badge badge-muted">Inactivo</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="sched-note">${I.info}<span>${(st.integrations || {}).stripe && st.integrations.stripe.configured ? `Los servicios con precio piden una señal del ${st.integrations.stripe.depositPercent} % al reservar online.` : 'Cualquier precio que se introduzca aquí se muestra en la web.'}</span></p>
      ${HAS_CLASSES() ? `<div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Clases en grupo</h3><button class="btn btn-quiet btn-sm" type="button" data-act="pv" data-v="horarios">Gestionar horarios y aforo ${I.arrow}</button></div>
      <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:8px">${st.classTypes.map(c => `<span class="badge badge-muted" style="font-size:.8rem">${esc(c.name)} · ${st.classTemplates.filter(t2 => t2.typeId === c.id && t2.active).length} sesiones/semana</span>`).join('')}</div></div>` : ''}`;
  }

  const HAS_CLASSES = () => !window.SITIO || (window.SITIO.modulos && window.SITIO.modulos.clases);
  /* ---------- Horarios y disponibilidad ---------- */
  function vHours() {
    const st = S.state;
    const mon = U.addDays(U.mondayOf(today()), P.clsWeek * 7);
    const matrix = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Especialista</th>${[1, 2, 3, 4, 5, 6, 7].map(d => `<th>${U.DAY_SHORT[d]}</th>`).join('')}<th>Franja</th></tr></thead><tbody>
      ${st.specialists.map(sp => `<tr data-act="edit-sp" data-id="${sp.id}" tabindex="0" role="button" aria-label="Editar horario de ${esc(sp.name)}"><td><span style="display:flex;gap:8px;align-items:center">${avatar(sp, 'xs')}<b>${esc(sp.name)}</b>${sp.active ? '' : '<span class="badge badge-muted">Inactivo</span>'}</span></td>
        ${[1, 2, 3, 4, 5, 6, 7].map(d => { const day = sp.schedule[d]; const brk = day && day.on && day.breaks.filter(b => b.s && b.e).length ? `<br><span style="color:var(--warn);font-size:.72rem">pausa ${day.breaks.filter(b => b.s).map(b => b.s + '–' + b.e).join(', ')}</span>` : ''; return `<td class="mono" style="font-size:.76rem;white-space:nowrap">${weekHoursText(sp, d).replace(' / ', '<br>')}${brk}</td>`; }).join('')}
        <td class="mono">${sp.slotStep}'</td></tr>`).join('')}
    </tbody></table></div>`;
    const cols = [0, 1, 2, 3, 4].map(i => {
      const d = U.addDays(mon, i);
      const ses = S.classSessions(d);
      return `<div class="wv-col ${d === today() ? 'today' : ''}"><h4>${fmtDay(d)}<span>${ses.reduce((n, s) => n + s.taken, 0)} plazas</span></h4><div class="wv-list">${ses.map(s => `<button type="button" class="cls-card ${s.full ? 'full' : ''}" data-act="open-class" data-template="${s.template.id}" data-date="${d}"><span class="mono" style="font-size:.72rem;color:var(--ink-3)">${s.template.start}–${s.template.end}</span><b>${esc(s.type.name)}</b><span class="seatbar"><i style="width:${s.capacity ? s.taken / s.capacity * 100 : 0}%"></i></span><span style="display:flex;justify-content:space-between"><span>${s.full ? '<b style="color:var(--danger)">Completa</b>' : s.free + ' libres'}</span><span class="mono">${s.taken}/${s.capacity}</span></span></button>`).join('') || '<span style="font-size:.75rem;color:var(--ink-3)">Sin clases</span>'}</div></div>`;
    }).join('');
    const tpl = st.classTemplates.slice().sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    return topbar('Horarios y disponibilidad', 'Agenda semanal del equipo, clases grupales y aforo') + `
      <section style="margin-bottom:28px"><div class="sub-head" style="margin-top:0"><h3>Horario semanal de cada especialista</h3><p>Cada profesional tiene su propio horario, pausas y duración de franja. Pulsa una fila para editarla.</p></div>${matrix}</section>
      <section style="margin-bottom:28px"><div class="sub-head" style="margin-top:0"><h3>Clases grupales: ocupación</h3>
        <div class="week-nav"><button class="icon-btn" type="button" data-act="cls-week" data-d="-1" ${P.clsWeek <= -1 ? 'disabled' : ''} aria-label="Semana anterior">${I.left}</button><b>${fmtDay(mon, 'num')} – ${fmtDay(U.addDays(mon, 4), 'num')}</b><button class="icon-btn" type="button" data-act="cls-week" data-d="1" ${P.clsWeek >= 3 ? 'disabled' : ''} aria-label="Semana siguiente">${I.right}</button></div></div>
        <div class="cal-scroll"><div class="cls-week">${cols}</div></div></section>
      <section><div class="sub-head" style="margin-top:0"><h3>Plantilla del horario de clases</h3><button class="btn btn-primary btn-sm" type="button" data-act="edit-tpl" data-id="">${I.plus}Añadir clase</button></div>
        <div class="notice" style="margin-bottom:12px">${I.info}<span>Cargado a partir del horario publicado en la web del centro. Revisa que siga vigente antes de abrir reservas reales.</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Día</th><th>Hora</th><th>Modalidad</th><th>Aforo</th><th>Estado</th></tr></thead><tbody>
        ${tpl.map(t => `<tr data-act="edit-tpl" data-id="${t.id}" tabindex="0" role="button" aria-label="Editar clase"><td>${U.DAY_NAMES[t.weekday]}</td><td class="mono">${t.start}–${t.end}</td><td>${esc((S.getClassType(t.typeId) || {}).name)}</td><td class="mono">${t.capacity} plazas</td><td>${t.active ? '<span class="badge st-confirmada">Activa</span>' : '<span class="badge badge-muted">Pausada</span>'}</td></tr>`).join('')}
        </tbody></table></div></section>`;
  }

  /* ---------- Configuración ---------- */
  function vConfig() {
    const st = S.state, c = st.center, s = st.settings, r = s.reminders || { enabled: false, offsetsMinutes: [], instructions: '' };
    const integ = st.integrations || { google: { configured: false, accounts: [] }, whatsapp: { provider: 'disabled' } };
    const off = r.offsetsMinutes || [];
    const offOpt = (sel) => [['', 'Sin recordatorio'], ['1440', '24 horas antes'], ['2880', '48 horas antes'], ['720', '12 horas antes'], ['240', '4 horas antes'], ['120', '2 horas antes'], ['60', '1 hora antes']].map(([v, l]) => `<option value="${v}" ${String(sel ?? '') === v ? 'selected' : ''}>${l}</option>`).join('');
    const WA = { meta: 'WhatsApp Business Platform (Meta)', twilio: 'Twilio', log: 'Modo prueba (no envía)', disabled: 'Desactivado' };
    const unhandled = st.messages.filter(m => !m.handledAt && !m.handled_at);
    return topbar('Configuración', 'Datos del centro, reservas, recordatorios e integraciones') + `
      <div class="dash">
        <form class="panel" id="cfg-form" novalidate><div class="panel-head"><h3>Datos del centro y reservas</h3><span>Se muestran en la web y en el asistente</span></div><div class="panel-body" style="display:grid;gap:12px">
          <div class="grid2"><div class="field"><label for="cfg-phone">Teléfono</label><input class="input" id="cfg-phone" name="phone" value="${esc(c.phone)}"></div><div class="field"><label for="cfg-email">Correo</label><input class="input" id="cfg-email" name="email" value="${esc(c.email)}"></div></div>
          <div class="grid2"><div class="field"><label for="cfg-address">Dirección</label><input class="input" id="cfg-address" name="address" value="${esc(c.address)}"></div><div class="field"><label for="cfg-city">Población</label><input class="input" id="cfg-city" name="city" value="${esc(c.city)}"></div></div>
          <div class="field"><label for="cfg-hours">Horario de atención al público</label><input class="input" id="cfg-hours" name="publicHours" value="${esc(c.publicHours)}"></div>
          <h4 class="lbl" style="margin-top:8px">Reglas de reserva online</h4>
          <div class="grid2"><div class="field"><label for="cfg-notice">Antelación mínima (minutos)</label><input class="input" id="cfg-notice" name="minNoticeMinutes" type="number" min="0" step="15" value="${s.minNoticeMinutes}"></div><div class="field"><label for="cfg-horizon">Reservas con hasta (días)</label><input class="input" id="cfg-horizon" name="bookingHorizonDays" type="number" min="7" max="180" value="${s.bookingHorizonDays}"></div></div>
          <div class="grid2"><div class="field"><label for="cfg-cap">Aforo por defecto de clases nuevas</label><input class="input" id="cfg-cap" name="defaultCapacity" type="number" min="1" max="40" value="${s.defaultCapacity}"></div>
          <div class="field"><label for="cfg-cancel">Cancelar o cambiar online hasta (horas antes)</label><input class="input" id="cfg-cancel" name="cancelMinNoticeHours" type="number" min="0" max="168" value="${s.cancelMinNoticeHours ?? 12}"></div></div>
          <div class="field"><label for="cfg-online">Estado de las citas reservadas online</label><select class="input" id="cfg-online" name="onlineStatus"><option value="confirmada" ${s.onlineStatus !== 'pendiente' ? 'selected' : ''}>Confirmada directamente</option><option value="pendiente" ${s.onlineStatus === 'pendiente' ? 'selected' : ''}>Pendiente: la confirma el centro</option></select></div>
          <h4 class="lbl" style="margin-top:8px">Recordatorios por WhatsApp</h4>
          <label class="toggle"><input type="checkbox" name="remEnabled" ${r.enabled ? 'checked' : ''}>Enviar recordatorios automáticos</label>
          <div class="grid2"><div class="field"><label for="cfg-r1">Primer recordatorio</label><select class="input" id="cfg-r1" name="rem1">${offOpt(off[0])}</select></div><div class="field"><label for="cfg-r2">Segundo recordatorio (opcional)</label><select class="input" id="cfg-r2" name="rem2">${offOpt(off[1])}</select></div></div>
          <div class="field"><label for="cfg-instr">Instrucciones que se incluyen en el recordatorio</label><textarea class="input" id="cfg-instr" name="instructions" maxlength="300" style="min-height:70px">${esc(r.instructions || '')}</textarea></div>
          <div><button class="btn btn-primary btn-sm" type="submit">Guardar cambios</button></div>
        </div></form>
        <div style="display:grid;gap:16px;align-content:start;min-width:0">
          <section class="panel"><div class="panel-head"><h3>Integraciones</h3></div><div class="panel-body" style="display:grid;gap:12px;font-size:.9rem">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span><b>Google Calendar</b><br><span style="color:var(--ink-3)">${S.mode === 'demo' ? 'No disponible en la demo' : integ.google.configured ? `${integ.google.accounts.length} cuenta(s) conectada(s). Vincula cada calendario desde la ficha del especialista.` : 'Sin configurar: añade GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el .env'}</span></span>${integ.google.configured ? '<span class="badge st-confirmada">Activo</span>' : '<span class="badge badge-muted">Inactivo</span>'}</div>
            ${(integ.google.accounts || []).map(a => `<div style="display:flex;justify-content:space-between;gap:8px;padding-left:10px;border-left:3px solid var(--line)"><span>${esc(a.email)}</span>${a.status === 'ok' ? '<span class="badge st-confirmada">Conectada</span>' : '<span class="badge st-cancelada" style="text-decoration:none">Reconectar</span>'}</div>`).join('')}
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span><b>WhatsApp</b><br><span style="color:var(--ink-3)">${WA[integ.whatsapp.provider] || integ.whatsapp.provider}</span></span>${['meta', 'twilio'].includes(integ.whatsapp.provider) ? '<span class="badge st-confirmada">Activo</span>' : '<span class="badge badge-muted">Inactivo</span>'}</div>
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span><b>Pagos con Stripe</b><br><span style="color:var(--ink-3)">${S.mode === 'demo' ? 'No disponible en la demo' : integ.stripe && integ.stripe.configured ? `Señal del ${integ.stripe.depositPercent} % al reservar online los servicios con precio${integ.stripe.testMode ? ' · <b>modo de prueba</b> (no se cobra de verdad)' : ''}` : 'Sin configurar: añade STRIPE_SECRET_KEY en el servidor'}</span></span>${integ.stripe && integ.stripe.configured ? `<span class="badge ${integ.stripe.testMode ? 'badge-muted' : 'st-confirmada'}">${integ.stripe.testMode ? 'Prueba' : 'Activo'}</span>` : '<span class="badge badge-muted">Inactivo</span>'}</div>
            ${S.mode === 'demo' ? '' : `<form id="wa-test" style="display:flex;gap:8px;flex-wrap:wrap"><label class="sr-only" for="wa-phone">Teléfono de prueba</label><input class="input" id="wa-phone" name="phone" placeholder="Tu móvil para una prueba" style="flex:1;min-width:160px"><button class="btn btn-ghost btn-sm" type="submit">Enviar prueba</button></form>
            <button class="btn btn-quiet btn-sm" type="button" data-act="load-notifs" style="justify-self:start">Ver últimos mensajes y errores</button><div id="notifs"></div>`}
          </div></section>
          <section class="panel"><div class="panel-head"><h3>Mensajes del formulario de contacto</h3><span>${unhandled.length} sin atender</span></div><div class="panel-body">${st.messages.slice(0, 30).map(m => `<div class="msg-item"><b>${esc(m.name)} · ${esc(m.email)}${m.phone ? ' · ' + esc(m.phone) : ''}</b><span>${esc(m.text)}</span><small>${new Date(m.createdAt).toLocaleString('es-ES')} ${m.handledAt || m.handled_at ? '· atendido' : `· <button class="btn btn-quiet btn-sm" type="button" data-act="msg-done" data-id="${m.id}">Marcar como atendido</button>`}</small></div>`).join('') || '<p class="empty">Aún no hay mensajes.</p>'}</div></section>
          ${S.mode === 'demo' ? `<section class="panel"><div class="panel-head"><h3>Datos de demostración</h3></div><div class="panel-body" style="display:grid;gap:10px">
            <p style="font-size:.88rem;color:var(--ink-2)">Pacientes, citas y horarios de profesionales son ficticios y viven en el almacenamiento local de este navegador.</p>
            ${P.confirm === 'reset' ? `<div class="confirm-box"><span>¿Restablecer todos los datos de la demo?</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="confirm-no">Cancelar</button><button class="btn btn-danger btn-sm" type="button" data-act="reset-demo">Restablecer</button></span></div>` : `<div><button class="btn btn-danger-ghost btn-sm" type="button" data-act="confirm-ask" data-v="reset">Restablecer datos de demostración</button></div>`}
          </div></section>` : ''}
        </div>
      </div>`;
  }

  /* ======================= DRAWERS ======================= */
  function renderDrawer() {
    const root = $('#drawer-root');
    if (!root) return;
    if (!P.drawer) { root.innerHTML = ''; return; }
    const d = P.drawer;
    const fn = { booking: dBooking, patient: dPatient, sp: dSpecialist, svc: dService, tpl: dTemplate, cls: dClass, newbk: dNewBooking }[d.type];
    const r = fn(d);
    if (!r) { P.drawer = null; root.innerHTML = ''; return; }
    root.innerHTML = `<div class="drawer-ov" data-act="drawer-close"></div><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" data-trap>
      <div class="drawer-head"><h2 id="dr-title">${r.title}</h2><button class="icon-btn" type="button" data-act="drawer-close" aria-label="Cerrar">${I.x}</button></div>
      <div class="drawer-body">${r.body}</div>${r.foot ? `<div class="drawer-foot">${r.foot}</div>` : ''}</section>`;
    if (d.focus !== false) { const h = $('#dr-title'); h && h.setAttribute('tabindex', '-1'); h && h.focus(); d.focus = false; }
    r.after && r.after();
  }
  function openDrawer(type, data) { P.drawer = Object.assign({ type, focus: true }, data); P.confirm = null; renderDrawer(); }
  function closeDrawer() { P.drawer = null; P.confirm = null; P.calendars = null; P.googleAccount = null; renderDrawer(); }
  const FORM_DRAWERS = ['sp', 'svc', 'tpl', 'newbk'];

  /* cita */
  function dBooking(d) {
    const b = S.state.bookings.find(x => x.id === d.id);
    if (!b) return null;
    const p = S.getPatient(b.patientId), sp = S.getSpecialist(b.specialistId);
    const statusBtns = ['pendiente', 'confirmada', 'completada'].map(s2 => `<button type="button" data-act="bk-status" data-id="${b.id}" data-st="${s2}" aria-pressed="${b.status === s2}" ${b.status === 'cancelada' ? 'disabled' : ''}>${U.STATUS[s2]}</button>`).join('');
    return {
      title: `${esc(ptName(b.patientId))}`,
      body: `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${statusBadge(b.status)}<span class="badge badge-muted">Origen: ${srcLabel(b.source)}</span></div>
        <div class="kv">
          <b>Servicio</b><span>${esc(svcName(b.serviceId))}</span>
          <b>Especialista</b><span style="display:flex;gap:8px;align-items:center">${avatar(sp, 'xs')}${esc(spName(b.specialistId))}</span>
          <b>Fecha</b><span>${cap(fmtDay(b.date, 'full'))}</span>
          <b>Hora</b><span class="mono">${b.start} – ${endTime(b.start, b.duration)} (${b.duration} min)</span>
          <b>Teléfono</b><span class="mono">${p ? esc(p.phone) : '—'}</span>
          <b>Correo</b><span>${p ? esc(p.email) : '—'}</span>
          <b>Creada</b><span>${new Date(b.createdAt).toLocaleString('es-ES')}</span>
          ${b.payment ? `<b>Señal online</b><span>${esc(b.payment.amount)} · ${({ pending: 'pendiente de pago', paid: 'pagada', refunded: 'devuelta', expired: 'no pagada (reserva caducada)' })[b.payment.status] || b.payment.status}${b.payment.paidAt && b.payment.status === 'paid' ? ` el ${new Date(b.payment.paidAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>` : ''}
          ${b.googleSync ? `<b>Google Calendar</b><span>${({ synced: 'Sincronizada', pending: 'Pendiente de sincronizar', not_connected: 'El especialista no tiene calendario vinculado', error: 'Error: ' + esc(b.googleSyncError || '') })[b.googleSync] || b.googleSync}</span>` : ''}
        </div>
        ${b.status === 'pendiente' || b.status === 'confirmada' ? `<details class="fieldset"><summary style="cursor:pointer;font-weight:600">Cambiar fecha u hora</summary>
          <form id="rs-form" style="display:grid;gap:10px;margin-top:10px" novalidate><div class="grid2"><div class="field"><label for="rs-date">Nueva fecha</label><input class="input" id="rs-date" name="date" type="date" value="${b.date}" min="${today()}"></div>
          <div class="field"><label for="rs-time">Hora libre</label><select class="input" id="rs-time" name="start"><option value="">Elige fecha</option></select></div></div>
          <div id="rs-err" aria-live="polite"></div><div><button class="btn btn-primary btn-sm" type="button" data-act="bk-resched" data-id="${b.id}">Cambiar y avisar al paciente</button></div></form></details>` : ''}
        ${b.status !== 'cancelada' ? `<div class="field"><span class="lbl">Estado de la cita</span><div class="seg" role="group" aria-label="Estado">${statusBtns}</div></div>` : `<div class="notice">${I.info}<span>Cita cancelada: el horario ha quedado libre para nuevas reservas${S.dayPlan(sp, b.date).working ? '' : ' (el especialista ya no trabaja en ese momento)'}.</span></div>`}
        ${b.payment && b.payment.status === 'pending' ? `<div class="notice warn">${I.info}<span>El paciente aún no ha pagado la señal. Si no la paga a tiempo, la reserva se cancelará sola y el hueco quedará libre.</span></div>` : ''}
        ${b.payment && b.payment.status === 'paid' && S.user && S.user() && S.user().role === 'admin' ? (P.confirm === 'refund-' + b.id
          ? `<div class="confirm-box" role="alert"><span>¿Devolver la señal de ${esc(b.payment.amount)} al paciente? Se reembolsa a su tarjeta (no se puede deshacer).</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="confirm-no">No</button><button class="btn btn-danger btn-sm" type="button" data-act="bk-refund" data-id="${b.id}">Sí, devolver</button></span></div>`
          : `<button class="btn btn-ghost btn-sm" type="button" data-act="confirm-ask" data-v="refund-${b.id}" style="width:fit-content">Devolver señal (${esc(b.payment.amount)})</button>`) : ''}
        ${p ? `<button class="btn btn-ghost btn-sm" type="button" data-act="open-patient" data-id="${p.id}" style="width:fit-content">Ver ficha del paciente</button>` : ''}
        ${P.confirm === 'cancel-' + b.id ? `<div class="confirm-box" role="alert"><span>¿Cancelar esta cita? El hueco quedará disponible en la web.${b.payment && b.payment.status === 'paid' ? ' La señal pagada no se devuelve automáticamente: usa «Devolver señal» si corresponde.' : ''}</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="confirm-no">No</button><button class="btn btn-danger btn-sm" type="button" data-act="bk-cancel" data-id="${b.id}">Sí, cancelar</button></span></div>` : ''}`,
      foot: b.status === 'cancelada' ? `<span></span><div class="r"><button class="btn btn-ghost" type="button" data-act="bk-status" data-id="${b.id}" data-st="confirmada">Reactivar cita</button></div>`
        : `<button class="btn btn-danger-ghost" type="button" data-act="confirm-ask" data-v="cancel-${b.id}">Cancelar cita</button><div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cerrar</button></div>`,
      after() {
        const f = $('#rs-form'); if (!f) return;
        const fill = async () => {
          f.elements.start.innerHTML = '<option value="">Consultando…</option>';
          let av = [];
          try { av = (await S.daySlots(b.specialistId, b.serviceId, f.elements.date.value)).filter(x => x.status === 'available'); } catch (e) { toast(e.message, 'err'); }
          f.elements.start.innerHTML = av.map(x => `<option value="${x.start}">${x.start}</option>`).join('') || '<option value="">Sin horas libres ese día</option>';
        };
        f.elements.date.addEventListener('change', fill);
        f.closest('details').addEventListener('toggle', e => { if (e.target.open && !f.dataset.loaded) { f.dataset.loaded = '1'; fill(); } });
      }
    };
  }

  /* paciente */
  function dPatient(d) {
    const p = d.id ? S.getPatient(d.id) : null;
    if (d.id && !p) return null;
    const editing = !p || d.edit;
    if (editing) {
      return {
        title: p ? 'Editar paciente' : 'Nuevo paciente',
        body: `<form id="pt-form" novalidate style="display:grid;gap:14px">
          <div class="field"><label for="pt-name">Nombre y apellidos</label><input class="input" id="pt-name" name="name" value="${esc(p ? p.name : '')}" required></div>
          <div class="grid2"><div class="field"><label for="pt-phone">Teléfono</label><input class="input" id="pt-phone" name="phone" value="${esc(p ? p.phone : '')}" inputmode="tel"></div><div class="field"><label for="pt-email">Correo</label><input class="input" id="pt-email" name="email" type="email" value="${esc(p ? p.email : '')}"></div></div>
          <div id="pt-err" aria-live="polite"></div>
          <div class="notice">${I.info}<span>Solo datos de contacto para gestionar citas. Esta demo no guarda diagnósticos ni historia clínica.</span></div></form>`,
        foot: `<span></span><div class="r"><button class="btn btn-ghost" type="button" data-act="${p ? 'open-patient' : 'drawer-close'}" data-id="${p ? p.id : ''}">Cancelar</button><button class="btn btn-primary" type="button" data-act="save-pt" data-id="${p ? p.id : ''}">Guardar</button></div>`
      };
    }
    const s = S.patientStats(p.id);
    return {
      title: esc(p.name),
      body: `<div class="kv"><b>Teléfono</b><span class="mono">${esc(p.phone)}</span><b>Correo</b><span>${esc(p.email)}</span><b>Próxima cita</b><span>${s.next ? `${cap(fmtDay(s.next.date, 'long'))} · ${s.next.start}` : '—'}</span><b>Última visita</b><span>${s.last ? cap(fmtDay(s.last.date, 'long')) : '—'}</span><b>Alta</b><span>${new Date(p.createdAt).toLocaleDateString('es-ES')}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="button" data-act="new-booking" data-pt="${p.id}">${I.plus}Nueva cita</button><button class="btn btn-ghost btn-sm" type="button" data-act="edit-pt" data-id="${p.id}">Editar datos</button></div>
        <h3 class="lbl" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em">Historial de reservas (${s.items.length})</h3>
        <div class="hist">${s.items.map(i => {
          if (i.kind === 'class') { const t = S.getTemplate(i.b.templateId); const ty = t && S.getClassType(t.typeId); return `<div><span class="mono">${fmtDay(i.date)}</span><span>${ty ? esc(ty.name) : 'Clase'} · ${i.start} <span class="badge badge-muted">Clase</span></span>${i.status === 'cancelada' ? statusBadge('cancelada') : ''}</div>`; }
          return `<div><span class="mono">${fmtDay(i.date)}</span><button type="button" data-act="open-booking" data-id="${i.id}" style="background:none;border:0;padding:0;text-align:left;color:inherit">${esc(svcName(i.b.serviceId))} · ${i.start} · ${esc(spName(i.b.specialistId))}</button>${statusBadge(i.status)}</div>`;
        }).join('') || '<div><span></span><span style="color:var(--ink-3)">Sin reservas</span><span></span></div>'}</div>
        ${P.confirm === 'del-' + p.id ? `<div class="confirm-box" role="alert"><span>¿Eliminar a ${esc(p.name)} y sus ${s.items.length} reservas de demostración?</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="confirm-no">Cancelar</button><button class="btn btn-danger btn-sm" type="button" data-act="del-pt" data-id="${p.id}">Eliminar</button></span></div>` : ''}`,
      foot: `<button class="btn btn-danger-ghost" type="button" data-act="confirm-ask" data-v="del-${p.id}">${I.trash}Eliminar paciente</button><div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cerrar</button></div>`
    };
  }

  /* especialista */
  const COLORS = ['sage', 'blue', 'sand', 'plum', 'teal', 'rose'];
  function blankSpecialist() {
    const sched = {}; for (let i = 1; i <= 7; i++) sched[i] = { on: i <= 5, blocks: i <= 5 ? [{ s: '09:00', e: '14:00' }] : [], breaks: [] };
    return { id: '', name: '', role: 'Fisioterapeuta', bio: 'Perfil de demostración editable.', demo: true, color: COLORS[S.state.specialists.length % COLORS.length], photo: null, serviceIds: [], active: true, slotStep: 30, schedule: sched, vacations: [] };
  }
  function dSpecialist(d) {
    const sp = d.draft;
    const svcs = S.state.services;
    const t = (n, v) => `<input class="input" type="time" step="300" name="${n}" value="${esc(v || '')}" aria-label="${n}">`;
    const rows = [1, 2, 3, 4, 5, 6, 7].map(i => {
      const day = sp.schedule[i] || { on: false, blocks: [], breaks: [] };
      const b1 = day.blocks[0] || {}, b2 = day.blocks[1] || {}, br = day.breaks[0] || {};
      return `<div class="sched-row ${day.on ? '' : 'off'}" data-day="${i}"><label class="toggle"><input type="checkbox" name="on-${i}" ${day.on ? 'checked' : ''} data-act="sch-day" aria-label="Trabaja el ${U.DAY_NAMES[i].toLowerCase()}">${U.DAY_SHORT[i]}</label>
        <div class="times"><div>Jornada ${t('b1s-' + i, b1.s)} a ${t('b1e-' + i, b1.e)}</div><div>2.º tramo ${t('b2s-' + i, b2.s)} a ${t('b2e-' + i, b2.e)}</div><div>Pausa ${t('brs-' + i, br.s)} a ${t('bre-' + i, br.e)}</div></div></div>`;
    }).join('');
    return {
      title: sp.id ? `Editar · ${esc(sp.name)}` : 'Nuevo especialista',
      body: `<form id="sp-form" novalidate style="display:grid;gap:16px">
        <div class="fieldset"><h4>Ficha</h4>
          <div style="display:flex;gap:14px;align-items:center"><span id="sp-photo-prev">${avatar(sp)}</span><div class="field"><label for="sp-photo">Fotografía</label><input id="sp-photo" type="file" accept="image/*" class="input" style="padding:.4em"></div>${sp.photo ? '<button class="btn btn-quiet btn-sm" type="button" data-act="sp-photo-clear">Quitar</button>' : ''}</div>
          <div class="grid2"><div class="field"><label for="sp-name">Nombre</label><input class="input" id="sp-name" name="name" value="${esc(sp.name)}" required></div><div class="field"><label for="sp-role">Especialidad</label><input class="input" id="sp-role" name="role" value="${esc(sp.role)}"></div></div>
          <div class="field"><label for="sp-bio">Biografía breve</label><textarea class="input" id="sp-bio" name="bio" style="min-height:80px">${esc(sp.bio)}</textarea></div>
          <div class="grid2"><div class="field"><label for="sp-color">Color en la agenda</label><select class="input" id="sp-color" name="color">${COLORS.map(c => `<option value="${c}" ${sp.color === c ? 'selected' : ''}>${{ sage: 'Verde', blue: 'Azul', sand: 'Arena', plum: 'Ciruela', teal: 'Turquesa', rose: 'Rosa' }[c]}</option>`).join('')}</select></div>
          <div class="field"><label for="sp-step">Duración de cada franja</label><select class="input" id="sp-step" name="slotStep">${[15, 20, 30, 45, 60].map(v => `<option value="${v}" ${Number(sp.slotStep) === v ? 'selected' : ''}>${v} minutos</option>`).join('')}</select></div></div>
          <label class="toggle"><input type="checkbox" name="active" ${sp.active ? 'checked' : ''}>Disponible para reservas online</label>
          <label class="check"><input type="checkbox" name="demo" ${sp.demo ? 'checked' : ''}><span>Mostrar como perfil de demostración</span></label>
        </div>
        <div class="fieldset"><h4>Servicios que ofrece</h4><div class="checks">${svcs.map(s => `<label><input type="checkbox" name="svc" value="${s.id}" ${sp.serviceIds.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div></div>
        <div class="fieldset"><h4>Horario semanal</h4><div class="sched-edit">${rows}</div><p style="font-size:.78rem;color:var(--ink-3)">Las citas se ofrecen cada «duración de franja» dentro de cada jornada, sin pisar la pausa. Si un servicio dura más que la franja, ocupa varias.</p></div>
        <div class="fieldset"><h4>Vacaciones y días no laborables</h4><div class="vac-list" id="vac-list">${(sp.vacations || []).map(v => vacRow(v)).join('')}</div><div><button class="btn btn-ghost btn-sm" type="button" data-act="vac-add">${I.plus}Añadir periodo</button></div></div>
        ${googleBlock(sp)}
        <div id="sp-err" aria-live="polite"></div>
        ${sp.id && P.confirm === 'del-sp' ? `<div class="confirm-box" role="alert"><span>¿Eliminar a ${esc(sp.name)}? Sus citas futuras se cancelarán.</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="confirm-no">Cancelar</button><button class="btn btn-danger btn-sm" type="button" data-act="del-sp" data-id="${sp.id}">Eliminar</button></span></div>` : ''}
      </form>`,
      foot: `${sp.id ? `<button class="btn btn-danger-ghost" type="button" data-act="confirm-ask" data-v="del-sp" data-keep="1">${I.trash}Eliminar</button>` : '<span></span>'}<div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cancelar</button><button class="btn btn-primary" type="button" data-act="save-sp">Guardar y aplicar</button></div>`,
      after() {
        const f = $('#sp-photo');
        f && f.addEventListener('change', () => {
          const file = f.files && f.files[0]; if (!file) return;
          const rd = new FileReader();
          rd.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); const sz = 240; c.width = c.height = sz; const ctx = c.getContext('2d'); const m = Math.min(img.width, img.height); ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, sz, sz); P.drawer.draft = readSpForm(); P.drawer.draft.photo = c.toDataURL('image/jpeg', .82); renderDrawer(); }; img.src = rd.result; };
          rd.readAsDataURL(file);
        });
      }
    };
  }
  function googleBlock(sp) {
    if (!sp.id) return '';
    if (S.mode === 'demo') return `<div class="fieldset"><h4>Google Calendar</h4><p style="font-size:.85rem;color:var(--ink-2)">En la versión real, cada especialista se vincula a su Google Calendar: las citas se crean como eventos y sus compromisos personales bloquean la agenda.</p></div>`;
    const g = sp.google || {};
    const integ = (S.state.integrations || {}).google || {};
    if (!integ.configured) return `<div class="fieldset"><h4>Google Calendar</h4><p style="font-size:.85rem;color:var(--ink-2)">Sin configurar en el servidor. Sigue docs/GOOGLE_CALENDAR.md.</p></div>`;
    const accId = P.googleAccount || g.accountId;
    const acc = (integ.accounts || []).find(a => a.id === accId);
    let inner;
    if (P.calendars && accId) {
      inner = `<div class="field"><label for="g-cal">Calendario de ${esc(sp.name)} ${acc ? `(${esc(acc.email)})` : ''}</label><select class="input" id="g-cal">${P.calendars.map(c => `<option value="${esc(c.id)}" data-name="${esc(c.name)}" ${c.id === g.calendarId ? 'selected' : ''}>${esc(c.name)}${c.primary ? ' (principal)' : ''}</option>`).join('')}</select></div>
        <div class="checks"><button class="btn btn-primary btn-sm" type="button" data-act="g-save" data-acc="${accId}">Usar este calendario</button><button class="btn btn-quiet btn-sm" type="button" data-act="g-connect">Usar otra cuenta de Google</button></div>`;
    } else if (g.calendarId) {
      inner = `<p style="font-size:.9rem">Vinculado a <b>${esc(g.calendarName || g.calendarId)}</b>${g.accountEmail ? ` · ${esc(g.accountEmail)}` : ''} ${g.accountStatus === 'revoked' ? '<span class="badge st-cancelada" style="text-decoration:none">Hay que reconectar</span>' : '<span class="badge st-confirmada">Sincronizando</span>'}</p>
        <div class="checks"><button class="btn btn-ghost btn-sm" type="button" data-act="g-pick" data-acc="${g.accountId}">Cambiar calendario</button>${g.accountStatus === 'revoked' ? '<button class="btn btn-primary btn-sm" type="button" data-act="g-connect">Reconectar</button>' : ''}<button class="btn btn-danger-ghost btn-sm" type="button" data-act="g-unlink">Desvincular</button></div>`;
    } else {
      inner = `<p style="font-size:.85rem;color:var(--ink-2)">Las citas de ${esc(sp.name)} se crearán como eventos en su calendario y sus eventos personales bloquearán la agenda online.</p>
        <div class="checks"><button class="btn btn-primary btn-sm" type="button" data-act="g-connect">Conectar con Google</button>${(integ.accounts || []).filter(a => a.status === 'ok').map(a => `<button class="btn btn-ghost btn-sm" type="button" data-act="g-pick" data-acc="${a.id}">Usar ${esc(a.email)}</button>`).join('')}</div>`;
    }
    return `<div class="fieldset"><h4>Google Calendar</h4>${inner}</div>`;
  }

  function vacRow(v) {
    return `<div class="vac-row"><input class="input" type="date" name="vfrom" value="${esc(v.from || '')}" aria-label="Desde" style="width:auto"><span>a</span><input class="input" type="date" name="vto" value="${esc(v.to || '')}" aria-label="Hasta" style="width:auto"><input class="input" name="vlabel" value="${esc(v.label || 'Vacaciones')}" aria-label="Motivo" style="width:140px"><button class="icon-btn" type="button" data-act="vac-del" aria-label="Quitar periodo">${I.trash}</button></div>`;
  }
  function readSpForm() {
    const f = $('#sp-form'); const d = P.drawer.draft;
    const g = n => f.elements[n] ? f.elements[n].value : '';
    const sp = JSON.parse(JSON.stringify(d));
    sp.name = g('name'); sp.role = g('role'); sp.bio = g('bio'); sp.color = g('color'); sp.slotStep = Number(g('slotStep'));
    sp.active = f.elements.active.checked; sp.demo = f.elements.demo.checked;
    sp.serviceIds = $$('input[name="svc"]:checked', f).map(x => x.value);
    for (let i = 1; i <= 7; i++) {
      const blocks = [[g('b1s-' + i), g('b1e-' + i)], [g('b2s-' + i), g('b2e-' + i)]].filter(([s, e]) => s && e).map(([s, e]) => ({ s, e }));
      const breaks = g('brs-' + i) && g('bre-' + i) ? [{ s: g('brs-' + i), e: g('bre-' + i) }] : [];
      sp.schedule[i] = { on: f.elements['on-' + i].checked && blocks.length > 0, blocks, breaks };
    }
    sp.vacations = $$('.vac-row', f).map(r => ({ from: r.querySelector('[name="vfrom"]').value, to: r.querySelector('[name="vto"]').value, label: r.querySelector('[name="vlabel"]').value })).filter(v => v.from && v.to);
    return sp;
  }

  /* servicio */
  function dService(d) {
    const s = d.id ? S.getService(d.id) : { id: '', name: '', short: '', description: '', duration: 45, price: null, active: true };
    if (!s) return null;
    return {
      title: s.id ? `Editar · ${esc(s.name)}` : 'Nuevo servicio',
      body: `<form id="svc-form" novalidate style="display:grid;gap:14px">
        <div class="field"><label for="svc-name">Nombre</label><input class="input" id="svc-name" name="name" value="${esc(s.name)}"></div>
        <div class="field"><label for="svc-short">Descripción breve (tarjeta de la web)</label><input class="input" id="svc-short" name="short" value="${esc(s.short)}"></div>
        <div class="field"><label for="svc-desc">Descripción</label><textarea class="input" id="svc-desc" name="description">${esc(s.description)}</textarea></div>
        <div class="grid2"><div class="field"><label for="svc-dur">Duración de la cita (min)</label><input class="input" id="svc-dur" name="duration" type="number" min="10" step="5" value="${s.duration}"></div>
        <div class="field"><label for="svc-price">${(S.state.integrations || {}).stripe && S.state.integrations.stripe.configured ? `Precio (€) · se cobra un ${S.state.integrations.stripe.depositPercent} % de señal al reservar online` : 'Precio orientativo (€, opcional)'}</label><input class="input" id="svc-price" name="price" type="number" min="0" step="1" value="${s.price == null ? '' : s.price}" placeholder="A consultar"></div></div>
        <div class="fieldset"><h4>Especialistas que lo ofrecen</h4><div class="checks">${S.state.specialists.map(sp => `<label><input type="checkbox" name="sp" value="${sp.id}" ${sp.serviceIds.includes(s.id) ? 'checked' : ''}>${esc(sp.name)}</label>`).join('')}</div></div>
        <label class="toggle"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}>Servicio activo y reservable online</label>
        <div class="notice warn">${I.info}<span>No introduzcas tarifas oficiales sin confirmarlas con el centro. En la web aparecerán como «orientativas».</span></div>
        <div id="svc-err" aria-live="polite"></div></form>`,
      foot: `<span></span><div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cancelar</button><button class="btn btn-primary" type="button" data-act="save-svc" data-id="${s.id}">Guardar</button></div>`
    };
  }

  /* plantilla de clase */
  function dTemplate(d) {
    const t = d.id ? S.getTemplate(d.id) : { id: '', typeId: (S.state.classTypes[0] || {}).id, weekday: 1, start: '18:00', end: '19:00', capacity: S.state.settings.defaultCapacity, active: true };
    if (!t) return null;
    return {
      title: t.id ? 'Editar clase' : 'Nueva clase',
      body: `<form id="tpl-form" novalidate style="display:grid;gap:14px">
        <div class="grid2"><div class="field"><label for="tpl-type">Modalidad</label><select class="input" id="tpl-type" name="typeId">${S.state.classTypes.map(c => `<option value="${c.id}" ${t.typeId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tpl-day">Día</label><select class="input" id="tpl-day" name="weekday">${[1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}" ${t.weekday === i ? 'selected' : ''}>${U.DAY_NAMES[i]}</option>`).join('')}</select></div></div>
        <div class="grid2"><div class="field"><label for="tpl-s">Inicio</label><input class="input" id="tpl-s" name="start" type="time" value="${t.start}"></div><div class="field"><label for="tpl-e">Fin</label><input class="input" id="tpl-e" name="end" type="time" value="${t.end}"></div></div>
        <div class="field"><label for="tpl-cap">Aforo máximo (plazas)</label><input class="input" id="tpl-cap" name="capacity" type="number" min="1" max="60" value="${t.capacity}"></div>
        <label class="toggle"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}>Clase activa (acepta reservas)</label>
        <div id="tpl-err" aria-live="polite"></div>
        ${t.id && P.confirm === 'del-tpl' ? `<div class="confirm-box" role="alert"><span>¿Eliminar esta clase del horario? Sus plazas reservadas se cancelarán.</span><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" type="button" data-act="confirm-no">Cancelar</button><button class="btn btn-danger btn-sm" type="button" data-act="del-tpl" data-id="${t.id}">Eliminar</button></span></div>` : ''}</form>`,
      foot: `${t.id ? `<button class="btn btn-danger-ghost" type="button" data-act="confirm-ask" data-v="del-tpl" data-keep="1">${I.trash}Eliminar</button>` : '<span></span>'}<div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cancelar</button><button class="btn btn-primary" type="button" data-act="save-tpl" data-id="${t.id}">Guardar</button></div>`
    };
  }

  /* sesión de clase */
  function dClass(d) {
    const ses = S.classSessions(d.date, { includeInactive: true }).find(s => s.template.id === d.template);
    if (!ses) return null;
    const atts = S.state.classBookings.filter(c => c.templateId === d.template && c.date === d.date && c.status !== 'cancelada');
    const ids = new Set(atts.map(a => a.patientId));
    return {
      title: `${esc(ses.type.name)} · ${fmtDay(d.date)} ${ses.template.start}`,
      body: `<div class="kpis" style="margin:0"><div class="kpi"><span>Plazas ocupadas</span><b>${ses.taken}</b></div><div class="kpi"><span>Plazas libres</span><b>${ses.free}</b></div><div class="kpi"><span>Aforo máximo</span><b>${ses.capacity}</b></div></div>
        ${ses.full ? `<div class="notice err">${I.info}<span>Clase completa: no admite más reservas desde la web ni desde el panel.</span></div>` : ''}
        <div class="field"><label for="cls-add">Añadir asistente</label><div style="display:flex;gap:8px;flex-wrap:wrap"><select class="input" id="cls-add" style="flex:1;min-width:200px" ${ses.full ? 'disabled' : ''}>${S.state.patients.filter(p => !ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn btn-primary btn-sm" type="button" data-act="cls-add" ${ses.full ? 'disabled' : ''}>Reservar plaza</button></div></div>
        <h3 class="lbl" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.1em">Asistentes (${atts.length})</h3>
        <div class="att-list">${atts.map(a => `<div><span>${esc(ptName(a.patientId))} <span class="badge badge-muted">${srcLabel(a.source)}</span></span><button class="btn btn-quiet btn-sm" type="button" data-act="cls-cancel" data-id="${a.id}">Liberar plaza</button></div>`).join('') || '<p class="empty">Sin asistentes todavía.</p>'}</div>`,
      foot: `<button class="btn btn-ghost btn-sm" type="button" data-act="edit-tpl" data-id="${ses.template.id}">Editar aforo u horario</button><div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cerrar</button></div>`
    };
  }

  /* nueva cita desde el panel */
  function dNewBooking(d) {
    const st = S.state;
    const svcId = d.serviceId || (d.specialistId ? (S.getSpecialist(d.specialistId) || {}).serviceIds[0] : st.services[0].id);
    return {
      title: 'Nueva cita',
      body: `<form id="nb-form" novalidate style="display:grid;gap:14px">
        <div class="field"><label for="nb-pt">Paciente</label><select class="input" id="nb-pt" name="patientId"><option value="__new">+ Paciente nuevo</option>${st.patients.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${d.patientId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div id="nb-newpt" class="grid2" ${d.patientId ? 'hidden' : ''}><div class="field"><label for="nb-name">Nombre y apellidos</label><input class="input" id="nb-name" name="name"></div><div class="field"><label for="nb-phone">Teléfono</label><input class="input" id="nb-phone" name="phone" inputmode="tel"></div><div class="field" style="grid-column:1/-1"><label for="nb-email">Correo</label><input class="input" id="nb-email" name="email" type="email"></div></div>
        <div class="grid2"><div class="field"><label for="nb-svc">Servicio</label><select class="input" id="nb-svc" name="serviceId">${st.services.filter(s => s.active).map(s => `<option value="${s.id}" ${svcId === s.id ? 'selected' : ''}>${esc(s.name)} · ${s.duration} min</option>`).join('')}</select></div>
        <div class="field"><label for="nb-sp">Especialista</label><select class="input" id="nb-sp" name="specialistId"></select></div></div>
        <div class="grid2"><div class="field"><label for="nb-date">Fecha</label><input class="input" id="nb-date" name="date" type="date" value="${d.date || today()}" min="${today()}"></div>
        <div class="field"><label for="nb-time">Hora disponible</label><select class="input" id="nb-time" name="start"></select></div></div>
        <div class="field"><label for="nb-st">Estado</label><select class="input" id="nb-st" name="status"><option value="confirmada">Confirmada</option><option value="pendiente">Pendiente</option></select></div>
        <div id="nb-err" aria-live="polite"></div></form>`,
      foot: `<span></span><div class="r"><button class="btn btn-ghost" type="button" data-act="drawer-close">Cancelar</button><button class="btn btn-primary" type="button" data-act="save-nb">Crear cita</button></div>`,
      after() {
        const f = $('#nb-form');
        const fillSp = () => {
          const sps = S.specialistsFor(f.elements.serviceId.value);
          const cur = f.elements.specialistId.value || d.specialistId;
          f.elements.specialistId.innerHTML = sps.map(s => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || '<option value="">Sin especialistas</option>';
        };
        const fillTime = async () => {
          const spId = f.elements.specialistId.value, date = f.elements.date.value;
          const want = f.elements.start.value || d.start;
          f.elements.start.innerHTML = '<option value="">Consultando…</option>';
          let av = [];
          try { av = spId && date ? (await S.daySlots(spId, f.elements.serviceId.value, date)).filter(s => s.status === 'available') : []; } catch (e) { toast(e.message, 'err'); }
          f.elements.start.innerHTML = av.map(s => `<option value="${s.start}" ${want === s.start ? 'selected' : ''}>${s.start}</option>`).join('') || '<option value="">Sin horas libres ese día</option>';
        };
        fillSp(); fillTime();
        f.elements.serviceId.addEventListener('change', () => { fillSp(); fillTime(); });
        f.elements.specialistId.addEventListener('change', fillTime);
        f.elements.date.addEventListener('change', fillTime);
        f.elements.patientId.addEventListener('change', () => { $('#nb-newpt').hidden = f.elements.patientId.value !== '__new'; });
        if (!d.patientId) f.elements.patientId.value = '__new';
      }
    };
  }

  /* ======================= ACCIONES ======================= */
  const err = (sel, msg) => { const el = $(sel); if (el) el.innerHTML = `<div class="notice err" role="alert">${I.info}<span>${esc(msg)}</span></div>`; };

  actions.pv = el => { P.view = el.dataset.v; P.drawer = null; P.confirm = null; render(); window.scrollTo(0, 0); const m = $('#pmain h1'); m && m.setAttribute('tabindex', '-1'); m && m.focus({ preventScroll: true }); };
  actions['ag-view'] = el => { P.agView = el.dataset.v; render(); };
  actions['ag-today'] = () => { P.agDate = today(); P.spWeek = U.mondayOf(today()); render(); };
  actions['ag-nav'] = el => {
    const d = Number(el.dataset.d);
    if (P.agView === 'day') P.agDate = U.addDays(P.agDate, d);
    else if (P.agView === 'week') P.agDate = U.addDays(P.agDate, 7 * d);
    else if (P.agView === 'sp') P.spWeek = U.addDays(P.spWeek, 7 * d);
    else { const [y, m] = P.agDate.split('-').map(Number); const x = new Date(y, m - 1 + d, 1); P.agDate = U.dk(x); }
    render();
  };
  actions['ag-goday'] = el => { P.agDate = el.dataset.d; P.agView = 'day'; render(); };
  actions['sp-sel'] = el => { P.spSel = el.dataset.id; render(); };
  actions['sp-agenda'] = el => { P.spSel = el.dataset.id; P.view = 'agenda'; P.agView = 'sp'; render(); window.scrollTo(0, 0); };
  actions['sp-toggle'] = async el => {
    const sp = JSON.parse(JSON.stringify(S.getSpecialist(el.dataset.id))); sp.active = el.checked;
    try { await S.saveSpecialist(sp); toast(sp.active ? `${sp.name}: agenda activada en la web` : `${sp.name}: agenda desactivada en la web`); } catch (e) { toast(e.message, 'err'); el.checked = !el.checked; }
  };
  actions['open-booking'] = el => openDrawer('booking', { id: el.dataset.id });
  actions['open-patient'] = el => { if (!el.dataset.id) { closeDrawer(); return; } openDrawer('patient', { id: el.dataset.id }); };
  actions['edit-pt'] = el => openDrawer('patient', { id: el.dataset.id || null, edit: true });
  actions['edit-sp'] = el => { const sp = el.dataset.id ? JSON.parse(JSON.stringify(S.getSpecialist(el.dataset.id))) : blankSpecialist(); openDrawer('sp', { draft: sp }); };
  actions['edit-svc'] = el => openDrawer('svc', { id: el.dataset.id });
  actions['edit-tpl'] = el => openDrawer('tpl', { id: el.dataset.id });
  actions['open-class'] = el => openDrawer('cls', { template: el.dataset.template, date: el.dataset.date });
  actions['new-booking'] = el => openDrawer('newbk', { specialistId: el.dataset.sp, date: el.dataset.date, start: el.dataset.start, patientId: el.dataset.pt });
  actions['drawer-close'] = () => closeDrawer();
  actions['confirm-ask'] = el => {
    if (P.drawer && P.drawer.type === 'sp') P.drawer.draft = readSpForm();
    P.confirm = el.dataset.v; if (P.drawer) renderDrawer(); else render();
  };
  actions['confirm-no'] = () => { if (P.drawer && P.drawer.type === 'sp') P.drawer.draft = readSpForm(); P.confirm = null; if (P.drawer) renderDrawer(); else render(); };
  actions['cls-week'] = el => { P.clsWeek = Math.max(-1, Math.min(3, P.clsWeek + Number(el.dataset.d))); render(); };

  actions['bk-status'] = async el => {
    try { await S.setBookingStatus(el.dataset.id, el.dataset.st); toast(`Cita marcada como ${U.STATUS[el.dataset.st].toLowerCase()}`); }
    catch (e) { toast(e.message, 'err'); }
  };
  actions['g-connect'] = async () => {
    try { P.drawer.draft = readSpForm(); location.href = await S.googleConnect(P.drawer.draft.id); } catch (e) { err('#sp-err', e.message); }
  };
  actions['g-pick'] = async el => {
    try { P.drawer.draft = readSpForm(); P.googleAccount = el.dataset.acc; P.calendars = await S.googleCalendars(el.dataset.acc); renderDrawer(); } catch (e) { err('#sp-err', e.message); }
  };
  actions['g-save'] = async el => {
    const sel = $('#g-cal'); const opt = sel.options[sel.selectedIndex];
    try {
      P.drawer.draft = readSpForm();
      const sp = await S.setCalendar(P.drawer.draft.id, { accountId: el.dataset.acc, calendarId: sel.value, calendarName: opt.dataset.name });
      P.drawer.draft.google = sp.google; P.calendars = null; P.googleAccount = null;
      toast('Calendario vinculado. Las citas futuras se sincronizan en segundo plano.'); renderDrawer();
    } catch (e) { err('#sp-err', e.message); }
  };
  actions['g-unlink'] = async () => {
    try { P.drawer.draft = readSpForm(); const sp = await S.setCalendar(P.drawer.draft.id, null); P.drawer.draft.google = sp.google; toast('Calendario desvinculado'); renderDrawer(); } catch (e) { err('#sp-err', e.message); }
  };
  actions['bk-resched'] = async el => {
    const f = $('#rs-form');
    if (!f.elements.start.value) { err('#rs-err', 'Elige una hora libre.'); return; }
    try { await S.rescheduleBooking(el.dataset.id, f.elements.date.value, f.elements.start.value); toast('Cita cambiada. El paciente recibirá el aviso.'); renderDrawer(); }
    catch (e) { err('#rs-err', e.message); }
  };
  actions['bk-refund'] = async el => { try { await S.refundBooking(el.dataset.id); P.confirm = null; toast('Señal devuelta al paciente.'); renderDrawer(); } catch (e) { toast(e.message, 'err'); } };
  actions['bk-cancel'] = async el => { try { await S.cancelBooking(el.dataset.id); P.confirm = null; toast('Cita cancelada. El horario vuelve a estar disponible.'); renderDrawer(); } catch (e) { toast(e.message, 'err'); } };
  actions['reset-demo'] = async () => { await S.reset(); P.confirm = null; toast('Datos de demostración restablecidos'); };

  actions['save-pt'] = async el => {
    const f = $('#pt-form');
    try {
      const p = await S.savePatient({ id: el.dataset.id || null, name: f.elements.name.value, phone: f.elements.phone.value, email: f.elements.email.value });
      toast('Paciente guardado'); openDrawer('patient', { id: p.id });
    } catch (e) { err('#pt-err', e.message); }
  };
  actions['del-pt'] = async el => { try { await S.deletePatient(el.dataset.id); toast('Paciente eliminado'); closeDrawer(); } catch (e) { toast(e.message, 'err'); } };

  actions['sch-day'] = el => { el.closest('.sched-row').classList.toggle('off', !el.checked); };
  actions['vac-add'] = () => { $('#vac-list').insertAdjacentHTML('beforeend', vacRow({ from: today(), to: today(), label: 'Vacaciones' })); };
  actions['vac-del'] = el => el.closest('.vac-row').remove();
  actions['sp-photo-clear'] = () => { P.drawer.draft = readSpForm(); P.drawer.draft.photo = null; renderDrawer(); };
  actions['save-sp'] = async () => {
    try {
      const sp = readSpForm();
      const saved = await S.saveSpecialist(sp);
      toast(`${saved.name}: cambios aplicados en la web y la agenda`);
      closeDrawer();
    } catch (e) { err('#sp-err', e.message); }
  };
  actions['del-sp'] = async el => { try { await S.deleteSpecialist(el.dataset.id); toast('Especialista eliminado'); closeDrawer(); } catch (e) { P.confirm = null; err('#sp-err', e.message); } };
  actions['save-svc'] = async el => {
    const f = $('#svc-form');
    try {
      await S.saveService({ id: el.dataset.id || '', name: f.elements.name.value, short: f.elements.short.value, description: f.elements.description.value, duration: f.elements.duration.value, price: f.elements.price.value, active: f.elements.active.checked }, $$('input[name="sp"]:checked', f).map(x => x.value));
      toast('Servicio guardado'); closeDrawer();
    } catch (e) { err('#svc-err', e.message); }
  };
  actions['save-tpl'] = async el => {
    const f = $('#tpl-form');
    try {
      await S.saveClassTemplate({ id: el.dataset.id || '', typeId: f.elements.typeId.value, weekday: f.elements.weekday.value, start: f.elements.start.value, end: f.elements.end.value, capacity: f.elements.capacity.value, active: f.elements.active.checked });
      toast('Horario de clase guardado'); closeDrawer();
    } catch (e) { err('#tpl-err', e.message); }
  };
  actions['del-tpl'] = async el => { try { await S.deleteClassTemplate(el.dataset.id); toast('Clase eliminada del horario'); closeDrawer(); } catch (e) { toast(e.message, 'err'); } };
  actions['cls-add'] = async () => {
    const d = P.drawer; const pid = $('#cls-add').value;
    try { await S.bookClass({ templateId: d.template, date: d.date, patientId: pid, source: 'panel' }, { allowPast: true }); toast('Plaza reservada'); }
    catch (e) { toast(e.message, 'err'); }
  };
  actions['cls-cancel'] = async el => { try { await S.cancelClassBooking(el.dataset.id); toast('Plaza liberada'); } catch (e) { toast(e.message, 'err'); } };
  actions['save-nb'] = async () => {
    const f = $('#nb-form'); const v = n => f.elements[n].value;
    try {
      const data = { serviceId: v('serviceId'), specialistId: v('specialistId'), date: v('date'), start: v('start'), status: v('status'), source: 'panel' };
      if (v('patientId') === '__new') Object.assign(data, { name: v('name'), phone: v('phone'), email: v('email') }); else data.patientId = v('patientId');
      const b = await S.createBooking(data);
      toast('Cita creada'); openDrawer('booking', { id: b.id });
    } catch (e) { err('#nb-err', e.message); }
  };

  /* filtros y campos del panel */
  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.pf;
    if (k === 'ptSearch') { P.ptSearch = e.target.value; const tb = $('#pt-body'); if (tb) tb.innerHTML = patientTbody(); }
  });
  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.pf;
    if (!k || k === 'ptSearch') return;
    if (k === 'jump') { if (e.target.value) { if (P.agView === 'sp') P.spWeek = U.mondayOf(e.target.value); else P.agDate = e.target.value; render(); } return; }
    P[k] = e.target.value; render();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && P.drawer) { closeDrawer(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.id === 'cfg-form') {
      e.preventDefault();
      const v = n => f.elements[n].value;
      const offsets = [v('rem1'), v('rem2')].filter(Boolean).map(Number).filter((x, i, a) => a.indexOf(x) === i);
      try {
        await S.saveCenter({ phone: v('phone'), email: v('email'), address: v('address'), city: v('city'), publicHours: v('publicHours') },
          { minNoticeMinutes: Math.max(0, Number(v('minNoticeMinutes')) || 0), bookingHorizonDays: Math.min(180, Math.max(7, Number(v('bookingHorizonDays')) || 60)), defaultCapacity: Math.max(1, Number(v('defaultCapacity')) || 12),
            cancelMinNoticeHours: Math.max(0, Number(v('cancelMinNoticeHours')) || 0), onlineStatus: v('onlineStatus'),
            reminders: { enabled: f.elements.remEnabled.checked, offsetsMinutes: offsets, instructions: v('instructions') } });
        toast('Configuración guardada');
      } catch (er) { toast(er.message, 'err'); }
    } else if (f.id === 'wa-test') {
      e.preventDefault();
      try { const r = await S.testWhatsapp(f.elements.phone.value); toast(`Mensaje de prueba enviado (${r.provider})`); } catch (er) { toast(er.message, 'err'); }
    } else if (f.id === 'login-form') {
      e.preventDefault();
      const box = $('#login-err');
      try { await S.login(f.elements.email.value, f.elements.password.value); await boot(); }
      catch (er) { box.innerHTML = `<div class="notice err" role="alert">${I.info}<span>${esc(er.message)}</span></div>`; }
    } else if (f.closest && f.closest('#panel')) e.preventDefault();
  });
  actions['logout'] = async () => { await S.logout(); location.reload(); };
  actions['msg-done'] = async el => { try { await S.markMessageHandled(el.dataset.id); } catch (er) { toast(er.message, 'err'); } };
  actions['load-notifs'] = async () => {
    const box = $('#notifs');
    box.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando…</div>';
    try {
      const r = await S.notifications();
      const st = { sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Error' };
      box.innerHTML = `<div class="att-list">${r.notifications.slice(0, 15).map(n => `<div><span>${esc(n.patient_name || n.to_phone)} · ${esc(n.kind)}</span><span class="badge ${n.status === 'failed' ? 'st-cancelada' : 'badge-muted'}" title="${esc(n.error || '')}">${st[n.status] || esc(n.status)}</span></div>`).join('') || '<p class="empty">Todavía no se ha enviado ningún mensaje.</p>'}</div>
        ${r.failedJobs.length ? `<h4 class="lbl" style="margin-top:10px">Tareas con errores</h4><div class="att-list">${r.failedJobs.map(j => `<div><span>${esc(j.type)} · intento ${j.attempts}</span><span style="font-size:.78rem;color:var(--danger)">${esc((j.last_error || '').slice(0, 90))}</span></div>`).join('')}</div>` : ''}`;
    } catch (er) { box.innerHTML = `<div class="notice err">${esc(er.message)}</div>`; }
  };

  function rerenderMain() {
    const keep = P.drawer && FORM_DRAWERS.includes(P.drawer.type);
    if (!keep) { render(); return; }
    const dr = $('#drawer-root');
    const nodes = dr ? Array.from(dr.childNodes) : [];
    const d = P.drawer; P.drawer = null;
    render();
    P.drawer = d;
    const nd = $('#drawer-root'); nodes.forEach(n => nd.appendChild(n));
  }

  function loginView(msg) {
    $('#panel').innerHTML = `<div class="login-wrap"><form class="login-card" id="login-form" novalidate>
      <span class="logo-img" role="img" aria-label="${esc((window.SITIO && window.SITIO.negocio.nombreCorto) || '')}" style="width:130px"></span><span class="logo-txt">${esc((window.SITIO && window.SITIO.negocio.nombreCorto) || '')}</span>
      <h1>Área profesional</h1>
      <p>Accede con tu usuario del centro.</p>
      ${msg ? `<div class="notice">${I.info}<span>${esc(msg)}</span></div>` : ''}
      <div class="field"><label for="lg-email">Correo</label><input class="input" id="lg-email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="lg-pass">Contraseña</label><input class="input" id="lg-pass" name="password" type="password" autocomplete="current-password" required></div>
      <div id="login-err" aria-live="polite"></div>
      <button class="btn btn-brand" type="submit">Entrar</button>
      <a href="../index.html" style="font-size:.85rem;color:var(--ink-2)">Volver a la web</a>
    </form></div>`;
    const i = $('#lg-email'); if (i) i.focus();
  }

  async function boot() {
    $('#panel').innerHTML = '<div class="login-wrap"><div class="loading"><span class="spinner"></span>Cargando el panel…</div></div>';
    try {
      await S.load();
    } catch (e) {
      if (e.status === 401) { loginView(); return; }
      $('#panel').innerHTML = `<div class="login-wrap"><div class="notice err">${I.info}<span>${esc(e.message)}</span></div></div>`;
      return;
    }
    const q = new URLSearchParams(location.search);
    const g = q.get('google');
    if (g) {
      history.replaceState(null, '', location.pathname);
      if (g === 'ok') {
        toast('Cuenta de Google conectada. Elige el calendario del especialista.');
        const spId = q.get('specialist');
        P.view = 'especialistas';
        if (spId && S.getSpecialist(spId)) { P.drawer = { type: 'sp', draft: JSON.parse(JSON.stringify(S.getSpecialist(spId))), focus: true }; P.googleAccount = q.get('account'); }
      } else toast(g === 'cancelado' ? 'Conexión con Google cancelada.' : 'No se pudo conectar con Google: ' + (q.get('msg') || ''), 'err');
    }
    render();
  }

  S.subscribe(() => { P.week = { key: null, data: null }; rerenderMain(); });
  window.PANEL = { get state() { return P; }, render: rerenderMain };
  if (S.mode === 'demo') boot();
  else S.session().then(u => (u ? boot() : loginView())).catch(e => loginView(e.message));
})();
