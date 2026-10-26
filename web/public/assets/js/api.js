/* Cliente de la API de Postural. Las claves y credenciales viven solo en el servidor. */
(function () {
  'use strict';
  if (window.PosturalAPI) return; // la demo sin servidor registra su propia implementación
  async function j(path, opts) {
    opts = opts || {};
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || (opts.body ? 'POST' : 'GET'),
        headers: opts.body ? { 'content-type': 'application/json' } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin'
      });
    } catch (e) {
      throw Object.assign(new Error('No hay conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.'), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) throw Object.assign(new Error((data && data.message) || 'No se ha podido completar la operación.'), { status: res.status, code: data && data.error, details: data && data.details });
    return data;
  }
  const qs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  let cfg;
  window.PosturalAPI = {
    mode: 'live',
    config: () => cfg || (cfg = j('/api/public/config').catch(e => { cfg = null; throw e; })),
    month: (specialistId, serviceId, month, exclude) => j('/api/public/availability/month?' + qs({ specialistId, serviceId, month, exclude })),
    day: (specialistId, serviceId, date, exclude) => j('/api/public/availability/day?' + qs({ specialistId, serviceId, date, exclude })),
    next: (serviceId, specialistIds, limit) => j('/api/public/availability/next?' + qs({ serviceId, specialistIds: specialistIds && specialistIds.join(','), limit })),
    book: body => j('/api/public/appointments', { body }),
    classes: (from, days) => j('/api/public/classes?' + qs({ from, days })),
    bookClass: body => j('/api/public/class-bookings', { body }),
    contact: body => j('/api/public/contact', { body }),
    manage: token => j('/api/public/manage/' + encodeURIComponent(token)),
    managePayment: token => j('/api/public/manage/' + encodeURIComponent(token) + '/payment', { body: {} }),
    manageCancel: token => j('/api/public/manage/' + encodeURIComponent(token) + '/cancel', { body: {} }),
    manageReschedule: (token, date, start) => j('/api/public/manage/' + encodeURIComponent(token) + '/reschedule', { body: { date, start } })
  };
})();
