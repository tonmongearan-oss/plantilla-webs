/* SOLO DEMO: adapta los datos del navegador a la interfaz del panel real. */
(function () {
  'use strict';
  const S = window.PosturalStore, E = window.PosturalEngine;
  S.load();
  S.mode = 'demo';
  S.user = () => ({ name: 'Demo', role: 'admin' });
  S.session = async () => S.user();
  S.weekGrid = async (spId, monday) => {
    const sp = S.getSpecialist(spId);
    return [0, 1, 2, 3, 4, 5, 6].map(i => {
      const date = E.addDays(monday, i);
      const r = S.slotsFor(spId, date, sp.slotStep, { ignoreNotice: true });
      return { date, plan: r.plan, slots: r.slots.map(x => ({ start: x.start, min: x.min, status: x.status, bookingId: x.booking ? x.booking.id : undefined })) };
    });
  };
  S.daySlots = async (spId, svcId, date) => S.serviceSlots(spId, svcId, date, { ignoreNotice: true }).slots.filter(s => s.status !== 'break').map(s => ({ start: s.start, status: s.status }));
  const no = async () => { throw new Error('No disponible en la demo: se activa en la versión instalada en el servidor.'); };
  S.googleConnect = no; S.googleCalendars = no; S.setCalendar = no; S.testWhatsapp = no;
  S.notifications = async () => ({ notifications: [], failedJobs: [] });
  S.state.integrations = { google: { configured: false, accounts: [] }, whatsapp: { provider: 'disabled' } };
})();
