/* Datos del panel desde la API (producción). Misma interfaz que la demo: el panel no sabe de dónde vienen. */
(function () {
  'use strict';
  const E = window.PosturalEngine;
  let state = null, user = null, csrf = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });

  async function j(path, opts) {
    opts = opts || {};
    const method = opts.method || (opts.body !== undefined ? 'POST' : 'GET');
    const headers = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
    let res;
    try { res = await fetch('/api/admin' + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' }); }
    catch (e) { throw Object.assign(new Error('Sin conexión con el servidor.'), { status: 0 }); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* vacío */ }
    if (!res.ok) throw Object.assign(new Error((data && data.message) || 'No se ha podido completar la operación.'), { status: res.status });
    return data;
  }
  const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  async function reload() { state = await j('/bootstrap'); emit(); return state; }
  async function mutate(p) { const r = await p; await reload(); return r; }

  const spBody = sp => ({ name: sp.name, role: sp.role, bio: sp.bio, photo: sp.photo, color: sp.color, active: sp.active, slotStep: sp.slotStep, schedule: sp.schedule, vacations: sp.vacations, serviceIds: sp.serviceIds });

  const api = {
    mode: 'live',
    get state() { return state; },
    user: () => user,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async session() { const r = await j('/me'); user = r.user; csrf = r.csrf || null; return user; },
    async login(email, password) { const r = await j('/login', { body: { email, password } }); user = r.user; csrf = r.csrf; return user; },
    async logout() { try { await j('/logout', { body: {} }); } finally { user = null; csrf = null; } },
    load: reload,

    // consultas sobre los datos cargados (motor compartido)
    getService: id => E.getService(state, id), getSpecialist: id => E.getSpecialist(state, id), getPatient: id => E.getPatient(state, id),
    getClassType: id => E.getClassType(state, id), getTemplate: id => E.getTemplate(state, id), specialistsFor: id => E.specialistsFor(state, id),
    dayPlan: E.dayPlan,
    slotsFor: (spId, date, dur, o) => E.slotsFor(state, spId, date, dur, o),
    serviceSlots: (spId, svcId, date, o) => E.serviceSlots(state, spId, svcId, date, o),
    dayStatus: (spId, svcId, date, o) => E.dayStatus(state, spId, svcId, date, o),
    nextAvailable: (spId, svcId, n, o) => E.nextAvailable(state, spId, svcId, n, o),
    nextAvailableAny: (svcId, ids, n, o) => E.nextAvailableAny(state, svcId, ids, n, o),
    classSessions: (date, o) => E.classSessions(state, date, o),
    patientStats: (pid, o) => E.patientStats(state, pid, o),

    // disponibilidad real (incluye Google Calendar), calculada en el servidor
    async weekGrid(spId, monday) { return (await j('/availability/week?' + qs({ specialistId: spId, from: monday }))).days; },
    async daySlots(spId, svcId, date) { return (await j('/availability/day?' + qs({ specialistId: spId, serviceId: svcId, date }))).slots; },

    // cambios
    createBooking: data => mutate(j('/appointments', { body: data })),
    setBookingStatus: (id, status) => mutate(j(`/appointments/${id}/status`, { body: { status } })),
    refundBooking: id => mutate(j(`/appointments/${id}/refund`, { body: {} })),
    cancelBooking: id => mutate(j(`/appointments/${id}/status`, { body: { status: 'cancelada' } })),
    rescheduleBooking: (id, date, start) => mutate(j(`/appointments/${id}/reschedule`, { body: { date, start } })),
    bookClass: data => mutate(j('/class-bookings', { body: { slotId: data.templateId, date: data.date, patientId: data.patientId } })),
    cancelClassBooking: id => mutate(j(`/class-bookings/${id}/cancel`, { body: {} })),
    savePatient: p => mutate(p.id ? j(`/patients/${p.id}`, { method: 'PUT', body: p }) : j('/patients', { body: p })),
    deletePatient: id => mutate(j(`/patients/${id}`, { method: 'DELETE' })),
    saveSpecialist: sp => mutate(sp.id ? j(`/specialists/${sp.id}`, { method: 'PUT', body: spBody(sp) }) : j('/specialists', { body: spBody(sp) })),
    deleteSpecialist: id => mutate(j(`/specialists/${id}`, { method: 'DELETE' })),
    saveService: (svc, specialistIds) => mutate(j(`/services/${svc.id || 'nuevo'}`, { method: 'PUT', body: { ...svc, specialistIds } })),
    saveClassTemplate: t => mutate(t.id ? j(`/class-slots/${t.id}`, { method: 'PUT', body: t }) : j('/class-slots', { body: t })),
    deleteClassTemplate: id => mutate(j(`/class-slots/${id}`, { method: 'DELETE' })),
    saveCenter: (center, settings) => mutate(j('/settings', { method: 'PUT', body: { center, settings } })),
    markMessageHandled: id => mutate(j(`/messages/${id}/handled`, { body: {} })),

    // integraciones
    googleConnect: async spId => (await j('/google/connect?' + qs({ specialistId: spId }))).url,
    googleCalendars: async accountId => (await j(`/google/accounts/${accountId}/calendars`)).calendars,
    setCalendar: (spId, cal) => mutate(j(`/specialists/${spId}/calendar`, { method: 'PUT', body: cal || {} })),
    notifications: () => j('/notifications'),
    testWhatsapp: phone => j('/whatsapp/test', { body: { phone } }),
    util: E
  };
  window.PosturalStore = api;
})();
