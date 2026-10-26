/* Motor de reservas en el navegador (funciones puras sobre el estado).
   Lo usan el panel (para pintar agendas) y la demo sin servidor. La autoridad real es la API. */
(function (global) {
  'use strict';
  /* ---------- utilidades de fecha y hora ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDk = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDk(s); d.setDate(d.getDate() + n); return dk(d); };
  const isoWd = s => { const g = parseDk(s).getDay(); return g === 0 ? 7 : g; };
  const tmin = t => { if (!t) return NaN; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const nowMin = d => d.getHours() * 60 + d.getMinutes();
  const uid = p => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const mondayOf = s => addDays(s, 1 - isoWd(s));

  const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const STATUS = {
    pendiente: 'Pendiente',
    confirmada: 'Confirmada',
    completada: 'Completada',
    cancelada: 'Cancelada'
  };


  /* ---------- consultas ---------- */
  const getService = (st, id) => st.services.find(s => s.id === id);
  const getSpecialist = (st, id) => st.specialists.find(s => s.id === id);
  const getPatient = (st, id) => st.patients.find(p => p.id === id);
  const getClassType = (st, id) => st.classTypes.find(c => c.id === id);
  const getTemplate = (st, id) => st.classTemplates.find(c => c.id === id);
  const specialistsFor = (st, serviceId) => st.specialists.filter(sp => sp.active && sp.serviceIds.includes(serviceId));

  function dayPlan(sp, date) {
    if (!sp) return { working: false, reason: 'missing', blocks: [], breaks: [] };
    if (!sp.active) return { working: false, reason: 'inactive', blocks: [], breaks: [] };
    const vac = (sp.vacations || []).find(v => v.from && v.to && date >= v.from && date <= v.to);
    if (vac) return { working: false, reason: 'vacation', label: vac.label || 'Vacaciones', blocks: [], breaks: [] };
    const day = sp.schedule[isoWd(date)];
    if (!day || !day.on) return { working: false, reason: 'off', blocks: [], breaks: [] };
    const blocks = (day.blocks || []).filter(b => b.s && b.e).map(b => [tmin(b.s), tmin(b.e)]).filter(b => b[1] > b[0]);
    if (!blocks.length) return { working: false, reason: 'off', blocks: [], breaks: [] };
    const breaks = (day.breaks || []).filter(b => b.s && b.e).map(b => [tmin(b.s), tmin(b.e)]).filter(b => b[1] > b[0]);
    return { working: true, blocks, breaks };
  }

  function activeBookings(st, spId, date, ignoreId) {
    return st.bookings.filter(b => b.specialistId === spId && b.date === date && b.status !== 'cancelada' && b.id !== ignoreId);
  }

  /** Huecos de un profesional en un día para una duración dada.
   *  status: available | booked | break | unavailable | past */
  function slotsFor(st, spId, date, duration, opts) {
    opts = opts || {};
    const sp = getSpecialist(st, spId);
    const plan = dayPlan(sp, date);
    if (!plan.working) return { plan, slots: [] };
    const step = Math.max(5, Number(sp.slotStep) || 30);
    const dur = Math.max(5, Number(duration) || step);
    const bks = activeBookings(st, spId, date, opts.ignoreId).map(b => ({ b, s: tmin(b.start), e: tmin(b.start) + Number(b.duration) }));
    const now = opts.now || new Date();
    const today = dk(now);
    const limit = nowMin(now) + (opts.ignoreNotice ? 0 : (st.settings.minNoticeMinutes || 0));
    const pastDay = date < today;
    const slots = [];
    for (const [bs, be] of plan.blocks) {
      for (let t = bs; t < be; t += step) {
        let status, booking = null;
        const brk = plan.breaks.find(br => t >= br[0] && t < br[1]);
        const occ = bks.find(x => overlaps(t, t + Math.min(step, be - t), x.s, x.e));
        if (brk) status = 'break';
        else if (occ) { status = 'booked'; booking = occ.b; }
        else {
          const fits = t + dur <= be && !plan.breaks.some(br => overlaps(t, t + dur, br[0], br[1])) && !bks.some(x => overlaps(t, t + dur, x.s, x.e));
          status = fits ? 'available' : 'unavailable';
          if (status === 'available' && (pastDay || (date === today && t < limit))) status = 'past';
        }
        slots.push({ start: fmt(t), min: t, status, booking });
      }
    }
    return { plan, slots };
  }

  function serviceSlots(st, spId, serviceId, date, opts) {
    const svc = getService(st, serviceId);
    return slotsFor(st, spId, date, svc ? svc.duration : 30, opts);
  }

  function dayStatus(st, spId, serviceId, date, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const today = dk(now);
    if (date < today) return 'past';
    if (date > addDays(today, st.settings.bookingHorizonDays || 60)) return 'closed';
    const { plan, slots } = serviceSlots(st, spId, serviceId, date, opts);
    if (!plan.working) return plan.reason === 'vacation' ? 'vacation' : 'off';
    const n = slots.filter(s => s.status === 'available').length;
    if (n > 0) return 'available';
    return slots.some(s => s.status === 'booked') ? 'full' : 'past';
  }

  function nextAvailable(st, spId, serviceId, limit, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    let d = opts.from || dk(now);
    const end = addDays(dk(now), st.settings.bookingHorizonDays || 60);
    const out = [];
    while (d <= end && out.length < limit) {
      const { slots } = serviceSlots(st, spId, serviceId, d, opts);
      for (const s of slots) if (s.status === 'available') { out.push({ date: d, start: s.start, specialistId: spId }); if (out.length >= limit) break; }
      d = addDays(d, 1);
    }
    return out;
  }

  /** próximos huecos combinando varios especialistas (para el chatbot) */
  function nextAvailableAny(st, serviceId, spIds, limit, opts) {
    const all = [];
    for (const id of spIds) all.push(...nextAvailable(st, id, serviceId, limit, opts));
    all.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return all.slice(0, limit);
  }

  function validateIndividual(st, b, opts) {
    opts = opts || {};
    const svc = getService(st, b.serviceId);
    if (!svc) return 'El servicio seleccionado no existe.';
    if (!svc.active && !opts.allowInactive) return 'Este servicio no está disponible para reserva online.';
    const sp = getSpecialist(st, b.specialistId);
    if (!sp) return 'El especialista seleccionado no existe.';
    if (!sp.active) return `${sp.name} no tiene agenda disponible en este momento.`;
    if (!sp.serviceIds.includes(b.serviceId)) return `${sp.name} no ofrece ${svc.name}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return 'Selecciona una fecha válida.';
    if (!/^\d{2}:\d{2}$/.test(b.start || '')) return 'Selecciona una hora válida.';
    const plan = dayPlan(sp, b.date);
    if (!plan.working) return plan.reason === 'vacation' ? `${sp.name} está de vacaciones ese día.` : `${sp.name} no trabaja ese día.`;
    const s = tmin(b.start), dur = Number(b.duration || svc.duration), e = s + dur;
    if (!plan.blocks.some(([bs, be]) => s >= bs && e <= be)) return 'La cita no cabe dentro del horario de trabajo del especialista.';
    if (plan.breaks.some(([bs, be]) => overlaps(s, e, bs, be))) return 'La cita coincide con un descanso del especialista.';
    const clash = activeBookings(st, sp.id, b.date, opts.ignoreId).find(x => overlaps(s, e, tmin(x.start), tmin(x.start) + Number(x.duration)));
    if (clash) return `Este horario ya está reservado (${clash.start}). Elige otra hora.`;
    if (!opts.allowPast) {
      const now = opts.now || new Date();
      const today = dk(now);
      if (b.date < today || (b.date === today && s < nowMin(now))) return 'No se pueden reservar horas pasadas.';
    }
    return null;
  }

  function classSessions(st, date, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const wd = isoWd(date);
    return st.classTemplates
      .filter(t => t.weekday === wd && (t.active || opts.includeInactive))
      .sort((a, b) => a.start.localeCompare(b.start) || a.typeId.localeCompare(b.typeId))
      .map(t => {
        const taken = st.classBookings.filter(c => c.templateId === t.id && c.date === date && c.status !== 'cancelada').length;
        const capacity = Number(t.capacity) || 0;
        const past = date < dk(now) || (date === dk(now) && tmin(t.start) <= nowMin(now));
        return { template: t, type: getClassType(st, t.typeId), date, taken, capacity, free: Math.max(0, capacity - taken), full: taken >= capacity, past };
      });
  }

  function patientByEmail(st, email) { const e = norm(email); return st.patients.find(p => norm(p.email) === e); }

  function patientStats(st, pid, opts) {
    const now = opts && opts.now || new Date();
    const stamp = dk(now) + ' ' + fmt(nowMin(now));
    const ind = st.bookings.filter(b => b.patientId === pid);
    const cls = st.classBookings.filter(b => b.patientId === pid);
    const items = [
      ...ind.map(b => ({ kind: 'individual', id: b.id, date: b.date, start: b.start, status: b.status, b })),
      ...cls.map(c => { const t = getTemplate(st, c.templateId); return { kind: 'class', id: c.id, date: c.date, start: t ? t.start : '--:--', status: c.status, b: c }; })
    ].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    const live = items.filter(i => i.status !== 'cancelada');
    const future = live.filter(i => i.date + ' ' + i.start >= stamp).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const past = live.filter(i => i.date + ' ' + i.start < stamp);
    return { items, next: future[0] || null, last: past[0] || null, count: items.length };
  }


  global.PosturalEngine = {
    dk, parseDk, addDays, isoWd, tmin, fmt, overlaps, nowMin, uid, clone, norm, mondayOf, DAY_NAMES, DAY_SHORT, MONTHS, STATUS,
    getService, getSpecialist, getPatient, getClassType, getTemplate, specialistsFor,
    dayPlan, activeBookings, slotsFor, serviceSlots, dayStatus, nextAvailable, nextAvailableAny, validateIndividual, classSessions, patientByEmail, patientStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
