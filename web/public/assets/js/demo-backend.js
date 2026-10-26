/* SOLO DEMO: implementa la API pública sobre los datos de demostración guardados en el navegador.
   En producción esta capa no se carga y la web usa la API real (api.js). */
(function () {
  'use strict';
  window.POSTURAL_MODE = 'demo';
  const S = window.PosturalStore, E = window.PosturalEngine;
  S.load();
  const later = fn => (...a) => new Promise((res, rej) => setTimeout(() => { try { res(fn(...a)); } catch (e) { rej(Object.assign(new Error(e.message), { status: /reservado|completa|aforo|plaza/.test(e.message) ? 409 : 400 })); } }, 90));
  const pubSp = sp => ({ id: sp.id, name: sp.name, role: sp.role, bio: sp.bio, photo: sp.photo, color: sp.color, serviceIds: sp.serviceIds, demo: sp.demo });
  const findAny = token => {
    const st = S.state;
    const b = st.bookings.find(x => x.id === token);
    if (b) return { kind: 'individual', b };
    const c = st.classBookings.find(x => x.id === token);
    if (c) return { kind: 'class', b: c };
    throw Object.assign(new Error('El enlace no es válido o ha caducado.'), { status: 404 });
  };
  const CANCEL_H = 12;
  function summary(token) {
    const st = S.state, f = findAny(token), p = S.getPatient(f.b.patientId) || { name: 'Paciente' };
    if (f.kind === 'individual') {
      const svc = S.getService(f.b.serviceId), sp = S.getSpecialist(f.b.specialistId);
      const starts = new Date(f.b.date + 'T' + f.b.start);
      return { kind: 'individual', patientFirstName: p.name.split(' ')[0], serviceId: f.b.serviceId, specialistId: f.b.specialistId, serviceName: svc ? svc.name : '', specialistName: sp ? sp.name : '', date: f.b.date, start: f.b.start, duration: f.b.duration, status: f.b.status, canChange: ['pendiente', 'confirmada'].includes(f.b.status) && starts - Date.now() > CANCEL_H * 3600e3, cancelMinNoticeHours: CANCEL_H, phone: st.center.phone };
    }
    const t = S.getTemplate(f.b.templateId), ty = t && S.getClassType(t.typeId);
    const starts = new Date(f.b.date + 'T' + (t ? t.start : '00:00'));
    return { kind: 'class', patientFirstName: p.name.split(' ')[0], serviceName: ty ? ty.name : 'Clase', specialistName: 'Equipo Postural', date: f.b.date, start: t ? t.start : '', duration: t ? E.tmin(t.end) - E.tmin(t.start) : 60, status: f.b.status, canChange: f.b.status !== 'cancelada' && starts - Date.now() > CANCEL_H * 3600e3, cancelMinNoticeHours: CANCEL_H, phone: st.center.phone };
  }
  window.PosturalAPI = {
    mode: 'demo',
    config: later(() => {
      const st = S.state;
      return { center: st.center, booking: { minNoticeMinutes: st.settings.minNoticeMinutes, horizonDays: st.settings.bookingHorizonDays, cancelMinNoticeHours: CANCEL_H },
        services: st.services.filter(s => s.active), specialists: st.specialists.filter(s => s.active).map(pubSp), classTypes: st.classTypes, whatsappEnabled: false, today: E.dk(new Date()) };
    }),
    month: later((spId, svcId, ym, exclude) => {
      const [y, m] = ym.split('-').map(Number), n = new Date(y, m, 0).getDate(), days = {};
      for (let d = 1; d <= n; d++) { const k = `${ym}-${String(d).padStart(2, '0')}`; days[k] = S.dayStatus(spId, svcId, k, { ignoreId: exclude }); }
      return { days };
    }),
    day: later((spId, svcId, date, exclude) => { const r = S.serviceSlots(spId, svcId, date, { ignoreId: exclude }); return { plan: r.plan, slots: r.slots.filter(s => s.status !== 'break').map(s => ({ start: s.start, status: s.status })) }; }),
    next: later((svcId, spIds, limit) => ({ slots: S.nextAvailableAny(svcId, spIds || S.specialistsFor(svcId).map(s => s.id), limit) })),
    book: later(body => {
      if (!body.privacyAccepted) throw new Error('Debes aceptar la política de privacidad para reservar.');
      const b = S.createBooking({ ...body, status: 'pendiente', source: body.source === 'chatbot' ? 'chatbot' : 'web' });
      return { appointment: b, manageUrl: 'cita.html?t=' + b.id };
    }),
    classes: later((from, days) => {
      const out = [];
      for (let i = 0; i < days; i++) {
        const d = E.addDays(from, i);
        for (const x of S.classSessions(d)) out.push({ slotId: x.template.id, typeId: x.template.typeId, typeName: x.type.name, date: d, start: x.template.start, end: x.template.end, capacity: x.capacity, taken: x.taken, free: x.free, full: x.full, past: x.past });
      }
      return { sessions: out };
    }),
    bookClass: later(body => {
      if (!body.privacyAccepted) throw new Error('Debes aceptar la política de privacidad para reservar.');
      const cb = S.bookClass({ templateId: body.slotId, date: body.date, name: body.name, phone: body.phone, email: body.email, source: 'web' });
      return { booking: cb, manageUrl: 'cita.html?t=' + cb.id };
    }),
    contact: later(body => { if (!body.privacyAccepted) throw new Error('Debes aceptar la política de privacidad.'); return S.addMessage(body); }),
    manage: later(summary),
    manageCancel: later(token => { const s = summary(token); if (!s.canChange) throw new Error(`Solo se puede cancelar online hasta ${CANCEL_H} horas antes.`); const f = findAny(token); if (f.kind === 'individual') S.cancelBooking(f.b.id); else S.cancelClassBooking(f.b.id); return summary(token); }),
    manageReschedule: later((token, date, start) => { const s = summary(token); if (!s.canChange) throw new Error(`Solo se puede cambiar online hasta ${CANCEL_H} horas antes.`); S.rescheduleBooking(findAny(token).b.id, date, start); return summary(token); })
  };
})();
