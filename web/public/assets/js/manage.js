/* Gestión de la cita por el paciente (cita.html?t=…): ver, cambiar de hora o cancelar. */
(function () {
  'use strict';
  const API = window.PosturalAPI;
  const { esc, $, I, actions, fmtDay, cap, addDays, calendarHtml, slotsHtml, qp } = window.UI;
  const root = document.getElementById('manage-app');
  if (!root) return;
  const token = qp().get('t') || '';
  const pago = qp().get('pago');   // 'ok' o 'cancelado' al volver de Stripe
  const M = { pago, checks: 0, s: null, error: null, mode: 'view', month: null, days: null, date: null, slots: null, start: null, busy: false, confirmCancel: false, cfg: null };

  const statusTxt = { pendiente: 'Pendiente de confirmar', confirmada: 'Confirmada', completada: 'Realizada', cancelada: 'Cancelada' };
  const payTxt = { pending: 'Pendiente de pago', paid: 'Pagada', refunded: 'Devuelta', expired: 'No pagada' };
  const hhmm = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  function payBlock(s) {
    const p = s.payment;
    if (!p) return '';
    if (p.status === 'pending' && s.status !== 'cancelada') {
      if (M.pago === 'ok' && M.checks < 6) return `<div class="notice">${I.info}<span><span class="spinner"></span> Estamos comprobando tu pago…</span></div>`;
      return `<div class="notice warn">${I.card}<span>${M.pago === 'cancelado' ? 'No se ha completado el pago. ' : ''}Tu cita <b>aún no está confirmada</b>: falta pagar la señal de <b>${esc(p.amount)}</b>.${p.url && p.expiresAt ? ` Te guardamos la hora hasta las <b>${hhmm(p.expiresAt)}</b>.` : ''}</span></div>
        ${p.url ? `<div class="acts"><a class="btn btn-brand" href="${esc(p.url)}">${I.card}Pagar señal de ${esc(p.amount)}</a></div>` : `<div class="notice err">${I.info}<span>El plazo para pagar ha terminado y la hora se ha liberado. Puedes hacer una nueva reserva.</span></div>`}`;
    }
    if (p.status === 'paid' && M.pago === 'ok' && s.status !== 'cancelada') return `<div class="notice ok">${I.check}<span><b>¡Pago recibido!</b> Tu cita está confirmada. Hemos cobrado la señal de ${esc(p.amount)}.</span></div>`;
    if (s.status === 'cancelada' && (p.status === 'paid' || p.status === 'refunded')) return `<div class="notice">${I.card}<span>${p.status === 'refunded' ? `Te hemos devuelto la señal de ${esc(p.amount)}. Puede tardar entre 5 y 10 días en aparecer en tu tarjeta.` : `Estamos tramitando la devolución de la señal de ${esc(p.amount)}.`}</span></div>`;
    return '';
  }

  function render() {
    if (M.error && !M.s) { root.innerHTML = `<div class="manage-card"><h2>No encontramos la cita</h2><p>${esc(M.error)}</p><div class="acts"><a class="btn btn-brand" href="reservar.html">Hacer una reserva</a><a class="btn btn-ghost" href="contacto.html">Contactar</a></div></div>`; return; }
    if (!M.s) { root.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando tu cita…</div>'; return; }
    const s = M.s;
    const rows = [['Servicio', s.serviceName], ['Profesional', s.specialistName], ['Fecha', cap(fmtDay(s.date, 'long'))], ['Hora', `${s.start} (${s.duration} min)`], ['Estado', s.payment && s.payment.status === 'pending' && s.status !== 'cancelada' ? 'Pendiente de pago' : (statusTxt[s.status] || s.status)]].concat(s.payment ? [['Señal', `${s.payment.amount} · ${payTxt[s.payment.status] || s.payment.status}`]] : []);
    let actionsHtml = '';
    if (s.status === 'cancelada') actionsHtml = `<div class="notice">${I.info}<span>Esta reserva está cancelada.</span></div><div class="acts"><a class="btn btn-brand" href="reservar.html">Reservar otra cita</a></div>`;
    else if (!s.canCancel && !s.canChange) actionsHtml = `<div class="notice warn">${I.info}<span>Las citas solo se pueden cambiar o cancelar online hasta ${s.cancelMinNoticeHours} horas antes. Llámanos al <b>${esc(s.phone)}</b>.</span></div>`;
    else if (M.mode === 'reschedule') {
      const horizon = addDays(window.UI.today, (M.cfg && M.cfg.booking.horizonDays) || 60);
      actionsHtml = `<h3 style="font-size:1.05rem">Elige la nueva fecha y hora</h3>
        ${M.error ? `<div class="notice err" role="alert">${I.info}<span>${esc(M.error)}</span></div>` : ''}
        <div class="cal-wrap"><div>${calendarHtml({ ym: M.month, days: M.days, selected: M.date, act: 'mg', canPrev: M.month > window.UI.today.slice(0, 7), canNext: `${M.month}-31` < horizon })}</div>
        <div>${slotsHtml({ date: M.date, slots: M.slots, selected: M.start, duration: s.duration, act: 'mg' })}</div></div>
        <div class="acts"><button class="btn btn-quiet" type="button" data-act="mg-cancel-mode">Volver</button><button class="btn btn-brand" type="button" data-act="mg-confirm-move" ${M.start && !M.busy ? '' : 'disabled'}>${M.start ? `Cambiar a ${fmtDay(M.date)} · ${M.start}` : 'Elige una hora'}</button></div>`;
    } else {
      actionsHtml = `${M.error ? `<div class="notice err" role="alert">${I.info}<span>${esc(M.error)}</span></div>` : ''}
        ${M.confirmCancel ? `<div class="confirm-box" role="alert"><span>¿Seguro que quieres cancelar? El hueco quedará libre para otra persona.${s.payment && s.payment.status === 'paid' ? ` Te devolveremos la señal de ${esc(s.payment.amount)}.` : ''}</span><span class="acts"><button class="btn btn-ghost btn-sm" type="button" data-act="mg-no">No, mantener</button><button class="btn btn-danger btn-sm" type="button" data-act="mg-do-cancel" ${M.busy ? 'disabled' : ''}>Sí, cancelar</button></span></div>` : ''}
        <div class="acts">${s.kind === 'individual' && s.canChange ? `<button class="btn btn-brand" type="button" data-act="mg-move">${I.cal}Cambiar fecha u hora</button>` : ''}<button class="btn btn-danger-ghost" type="button" data-act="mg-ask-cancel">Cancelar ${s.kind === 'class' ? 'plaza' : 'cita'}</button></div>`;
    }
    root.innerHTML = `<div class="manage-card">
      <span class="eyebrow">${s.kind === 'class' ? 'Tu plaza en clase' : 'Tu cita'}</span>
      <h2>Hola, ${esc(s.patientFirstName)}</h2>
      <div class="review">${rows.map(([k, v]) => `<div><b>${k}</b><span>${esc(v)}</span></div>`).join('')}</div>
      ${payBlock(s)}
      ${actionsHtml}
      ${API.mode === 'demo' ? `<div class="notice warn">${I.info}<span>Demo: los cambios se guardan solo en este navegador.</span></div>` : ''}
    </div>`;
  }

  async function load() {
    try { M.s = M.pago && API.managePayment ? await API.managePayment(token) : await API.manage(token); M.error = null; } catch (e) { M.error = e.message; }
    render();
    // Al volver de Stripe el pago puede tardar unos segundos en constar: se vuelve a comprobar.
    if (M.pago === 'ok' && M.s && M.s.payment && M.s.payment.status === 'pending' && M.checks < 6) { M.checks++; setTimeout(load, 2500); }
    else if (M.pago === 'ok' && M.checks >= 6) render();
  }
  async function loadMonth() {
    M.days = null; render();
    try { M.days = (await API.month(M.s.specialistId, M.s.serviceId, M.month, token)).days; } catch (e) { M.error = e.message; M.days = {}; }
    render();
  }
  async function loadDay() {
    M.slots = null; render();
    try { M.slots = (await API.day(M.s.specialistId, M.s.serviceId, M.date, token)).slots; } catch (e) { M.error = e.message; M.slots = []; }
    render();
  }

  actions['mg-move'] = async () => { M.mode = 'reschedule'; M.error = null; M.month = M.s.date.slice(0, 7); M.date = null; M.start = null; M.cfg = M.cfg || await API.config().catch(() => null); loadMonth(); };
  actions['mg-cancel-mode'] = () => { M.mode = 'view'; M.error = null; render(); };
  actions['mg-day'] = el => { M.date = el.dataset.date; M.start = null; loadDay(); };
  actions['mg-slot'] = el => { M.start = el.dataset.start; render(); };
  actions['mg-month'] = el => {
    const [y, m] = M.month.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
    M.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; M.date = null; M.start = null; loadMonth();
  };
  actions['mg-confirm-move'] = async () => {
    M.busy = true; render();
    try { M.s = await API.manageReschedule(token, M.date, M.start); M.mode = 'view'; M.error = null; window.UI.toast('Cita cambiada. Te hemos enviado la nueva hora.'); }
    catch (e) { M.error = e.message; if (e.status === 409) loadDay(); }
    M.busy = false; render();
  };
  actions['mg-ask-cancel'] = () => { M.confirmCancel = true; render(); };
  actions['mg-no'] = () => { M.confirmCancel = false; render(); };
  actions['mg-do-cancel'] = async () => {
    M.busy = true; render();
    try { M.s = await API.manageCancel(token); M.confirmCancel = false; M.error = null; M.pago = null; window.UI.toast('Reserva cancelada.'); }
    catch (e) { M.error = e.message; }
    M.busy = false; render();
  };

  if (!token) { M.error = 'Falta el código de la cita. Usa el enlace que recibiste al reservar.'; render(); } else { render(); load(); }
})();
