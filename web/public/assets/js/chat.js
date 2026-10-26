/* Asistente de la web: responde preguntas frecuentes con la información del centro y
   ayuda a reservar consultando la misma disponibilidad que el calendario. No diagnostica. */
(function () {
  'use strict';
  const API = window.PosturalAPI;
  const { esc, $, I, actions, fmtDay, addDays, mondayOf, DAY_NAMES } = window.UI;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const CH = { open: false, msgs: [], typing: false, flow: null };
  let CFG = null;
  const SITE = window.SITIO || { negocio: { nombre: '', nombreCorto: '' }, modulos: { clases: true }, clases: { nombre: 'Postural', etiqueta: 'clases de Postural' }, asistente: {} };
  const CLS = SITE.modulos && SITE.modulos.clases && SITE.clases;
  const AS = SITE.asistente || {};
  const short = () => SITE.negocio.nombreCorto || SITE.negocio.nombre;
  // Respuestas propias del negocio (sitio.json → asistente.faq): se comprueban antes que las genéricas.
  const FAQ = (AS.faq || []).map(f => ({ re: new RegExp(f.patron), nore: f.excepto ? new RegExp(f.excepto) : null, html: f.respuesta, acts: (f.acciones || []).map(a => ({ label: a[0], k: a[1], v: a[2] == null ? '' : a[2] })) }));

  const bot = (html, acts) => CH.msgs.push({ from: 'bot', html, acts: acts || [] });
  const user = text => CH.msgs.push({ from: 'user', html: esc(text) });
  const A = (label, k, v) => ({ label, k, v: v == null ? '' : v });
  const MAIN = () => [A('Reservar una cita', 'flow', 'start'), A('Servicios', 'ask', '¿Qué servicios ofrecéis?'), A('Horarios', 'ask', '¿Cuál es el horario de atención?'), A('¿Dónde estáis?', 'ask', '¿Dónde está el centro?')];
  const contact = () => `Teléfono <b>${esc(CFG.center.phone)}</b> · ${esc(CFG.center.email)}\nAtención al público: ${esc(CFG.center.publicHours.toLowerCase())}.`;
  const has = (t, re) => re.test(t);

  async function answer(raw) {
    const t = norm(raw);
    if (!t) return;
    const svc = CFG.services.find(s => t.includes(norm(s.name)));
    for (const f of FAQ) if (f.re.test(t) && !(f.nore && f.nore.test(t))) { bot(f.html.replace(/\{contacto\}/g, contact()), f.acts); return; }
    if (AS.salud && has(t, /(me duele|duele|dolor de|que tratamiento|que me recomiend|necesito (un )?tratamiento|diagnost|sintoma|es grave|me han operado|mareo|hormigue)/)) {
      bot('Entiendo que te preocupe. No puedo valorar síntomas ni decirte qué tratamiento necesitas: eso requiere que te vea un profesional sanitario.\n\nSi el dolor es intenso, aparece de golpe o viene con otros síntomas, consulta con tu médico o con urgencias.',
        [SITE.servicioInicial ? A('Reservar una primera visita', 'svc', SITE.servicioInicial) : A('Reservar', 'flow', 'start'), A('Contactar', 'ask', '¿Cómo os contacto?')]);
      return;
    }
    if (svc && has(t, /(que es|en que consiste|informacion|info|como es|para que)/)) return serviceInfo(svc);
    if (has(t, /(reserv|cita|pedir hora|agendar|hueco|disponibilidad|apuntar|inscrib)/)) {
      if (CLS && has(t, new RegExp('(clase|grupo|' + norm(CLS.nombre) + ')')) && !svc) return startClassFlow();
      if (svc) return chooseService(svc.id);
      return startFlow();
    }
    if (has(t, /(precio|cuesta|cuanto vale|cuanto es|tarifa|coste|pagar|euros|€)/)) {
      const priced = CFG.services.filter(s => s.price != null);
      bot(priced.length ? 'Precios:\n' + priced.map(s => `• <b>${esc(s.name)}</b>: ${String(s.price).replace('.', ',')} €`).join('\n') + (CFG.payments && CFG.payments.enabled ? `\n\nAl reservar online se paga una señal del ${CFG.payments.depositPercent} %; el resto, el día de la cita.` : '') : `Los precios te los dan directamente:\n${contact()}`, [A('Reservar', 'flow', 'start')]);
      return;
    }
    if (has(t, /(donde|direccion|ubicad|como llego|llegar|mapa)/)) { bot(`Estamos en <b>${esc(CFG.center.address)}, ${esc(CFG.center.city)}</b>.`, [A('Ver contacto y mapa', 'link', 'contacto.html')]); return; }
    if (CLS && has(t, /(horario|hora|cuando)/) && has(t, new RegExp('(clase|grupo|sesion|' + norm(CLS.nombre) + ')'))) return classSchedule(t);
    if (has(t, /(horario|abris|abre|cerrais|cierra|atencion al publico|a que hora)/)) {
      bot(`Horario: <b>${esc(CFG.center.publicHours.toLowerCase())}</b>.\n\nLas citas son con reserva previa${CFG.specialists.length > 1 ? ' y cada profesional tiene su propia agenda' : ''}.${CLS ? ` Las ${esc(CLS.etiqueta)} tienen horario fijo por grupo.` : ''}`, [CLS ? A('Horario de clases', 'ask', 'Horario de las clases') : A('Contactar', 'ask', '¿Cómo os contacto?'), A('Ver horas libres', 'flow', 'start')]);
      return;
    }
    if (CLS && has(t, /(nivel|grupo|modalidad)/) && !has(t, /especialista/)) {
      bot(`Grupos de ${esc(CLS.nombre)}:\n` + CFG.classTypes.map(c => `• <b>${esc(c.name)}</b>: ${esc(c.text)}`).join('\n'), [A('Ver horario de clases', 'ask', 'Horario de las clases'), A('Reservar plaza', 'flow', 'class')]);
      return;
    }
    if (has(t, /(especialista|fisioterapeut|equipo|quien|doctor|dra|medico|profesional|entrenador|mecanic|tecnic)/)) {
      const sps = CFG.specialists;
      bot((sps.length ? 'Profesionales con agenda online:\n' + sps.map(s => `• <b>${esc(s.name)}</b>: ${esc(s.role)}`).join('\n') : 'Estamos actualizando las fichas del equipo.') + (AS.equipoExtra ? '\n\n' + AS.equipoExtra : ''), [A('Reservar con un profesional', 'flow', 'start'), A('Ver el equipo', 'link', 'especialistas.html')]);
      return;
    }
    if (svc) return serviceInfo(svc);
    if (has(t, /(servicio|ofrece|tratamiento|haceis|que hac|trabajo|arregl)/)) {
      bot('Servicios:\n' + (CLS ? `• <b>${esc(CLS.nombre)}</b> (clases en grupo)\n` : '') + CFG.services.map(s => `• <b>${esc(s.name)}</b>: ${esc(s.short)}`).join('\n'), [A('Reservar', 'flow', 'start'), A('Ver servicios', 'link', 'servicios.html')]);
      return;
    }
    if (has(t, /(telefono|llamar|correo|email|mail|contact|whatsapp|escribir)/)) { bot(contact(), [A('Ir a contacto', 'link', 'contacto.html')]); return; }
    if (has(t, /^(hola|buenas|buenos|hey|ey)/)) { bot('¡Hola! ¿En qué te puedo ayudar?', MAIN()); return; }
    if (has(t, /(gracias|perfecto|genial|vale)/)) { bot('A ti. Si necesitas algo más, aquí estoy.', MAIN()); return; }
    bot(`No tengo información fiable sobre eso y prefiero no inventarla. Te atienden directamente:\n${contact()}`, MAIN());
  }

  function serviceInfo(s) {
    const sps = CFG.specialists.filter(x => x.serviceIds.includes(s.id));
    bot(`<b>${esc(s.name)}</b>\n${esc(s.description || s.short)}\n\nCita de ${s.duration} min${sps.length ? ' · ' + sps.map(x => esc(x.name)).join(', ') : ''}.`, [A('Ver horas libres', 'svc', s.id), A('Otros servicios', 'ask', '¿Qué servicios ofrecéis?')]);
  }

  async function classSchedule(t) {
    const type = CFG.classTypes.find(c => norm(c.name) !== norm(CLS.nombre) && t.includes(norm(c.name))) || null;
    const ses = (await API.classes(mondayOf(window.UI.today), 7)).sessions.filter(s => !type || s.typeId === type.id);
    const lines = [1, 2, 3, 4, 5].map(i => {
      const l = ses.filter(s => new Date(s.date + 'T12:00').getDay() === i % 7).map(s => `${s.start}${type ? '' : ' ' + esc(s.typeName)}`);
      return l.length ? `<b>${DAY_NAMES[i]}</b>: ${l.join(' · ')}` : null;
    }).filter(Boolean);
    bot(`Horario de ${type ? esc(type.name) : esc(CLS.etiqueta)}:\n${lines.join('\n')}`, [A('Ver plazas libres', 'flow', 'class'), A('Ver horario completo', 'link', 'horarios.html')]);
  }

  function startFlow() {
    CH.flow = {};
    const list = CFG.services.filter(s => CFG.specialists.some(sp => sp.serviceIds.includes(s.id)));
    bot('Perfecto. ¿Qué servicio quieres consultar?', list.map(s => A(s.name, 'svc', s.id)).concat(CLS ? [A(`Clase de ${CLS.nombre} (grupo)`, 'flow', 'class')] : []));
  }
  async function chooseService(id) {
    const s = CFG.services.find(x => x.id === id);
    const sps = CFG.specialists.filter(x => x.serviceIds.includes(id));
    CH.flow = { serviceId: id };
    if (!sps.length) { bot(`${esc(s.name)} se reserva por teléfono por ahora:\n${contact()}`); return; }
    if (sps.length === 1) return chooseSpecialist(sps[0].id);
    bot(`${esc(s.name)}: ¿prefieres algún especialista?`, sps.map(x => A(x.name, 'sp', x.id)).concat([A('Sin preferencia', 'sp', '')]));
  }
  async function chooseSpecialist(spId) {
    const f = CH.flow || {};
    if (!f.serviceId) return startFlow();
    const s = CFG.services.find(x => x.id === f.serviceId);
    const r = await API.next(f.serviceId, spId ? [spId] : null, 6);
    if (!r.slots.length) { bot(`No encuentro horas libres de ${esc(s.name)} en las próximas semanas. Llámanos y te buscamos un hueco:\n${contact()}`); return; }
    const name = id => { const sp = CFG.specialists.find(x => x.id === id); return sp ? (sp.name.split(' ')[0] === 'Dra.' ? sp.name : sp.name.split(' ')[0]) : ''; };
    bot(`Próximas horas libres de <b>${esc(s.name)}</b>${spId ? ' con ' + esc(CFG.specialists.find(x => x.id === spId).name) : ''}, consultadas ahora mismo en la agenda:`,
      r.slots.map(x => A(`${fmtDay(x.date)} · ${x.start}${spId ? '' : ' · ' + name(x.specialistId)}`, 'go', `reservar.html?servicio=${f.serviceId}&especialista=${x.specialistId}&fecha=${x.date}&hora=${x.start}&origen=asistente`))
        .concat([A('Ver el calendario completo', 'go', `reservar.html?servicio=${f.serviceId}${spId ? '&especialista=' + spId : ''}&origen=asistente`)]));
  }
  async function startClassFlow() {
    const today = window.UI.today;
    const ses = (await API.classes(today, 14)).sessions.filter(s => !s.full && !s.past).slice(0, 6);
    bot(`Próximas ${esc(CLS.etiqueta)} con plazas libres:`, ses.map(s => A(`${fmtDay(s.date)} ${s.start} · ${s.typeName} · ${s.free} libres`, 'go', `reservar.html?clase=${s.slotId}&fecha=${s.date}&origen=asistente`)).concat([A('Ver todas las clases', 'go', 'reservar.html?modo=clase&origen=asistente')]));
  }

  function render() {
    const rootEl = $('#chat-root'), fab = $('#chat-fab');
    if (!rootEl) return;
    if (!CH.open) { rootEl.innerHTML = ''; if (fab) fab.hidden = false; return; }
    if (fab) fab.hidden = true;
    const log = CH.msgs.map(m => {
      const acts = m.acts && m.acts.length ? `<div class="msg-actions">${m.acts.map(a => `<button type="button" class="chip ${a.k === 'go' && /fecha=/.test(a.v) ? 'slot-chip' : ''}" data-act="chat-act" data-k="${a.k}" data-v="${esc(a.v)}">${esc(a.label)}</button>`).join('')}</div>` : '';
      return `<div class="msg ${m.from}">${m.html}</div>${acts}`;
    }).join('') + (CH.typing ? '<div class="msg bot typing" aria-label="Escribiendo"><i></i><i></i><i></i></div>' : '');
    rootEl.innerHTML = `<section class="chat" role="dialog" aria-label="Asistente de ${esc(short())}">
      <div class="chat-head"><span class="av">${I.chat}</span><div><b>Asistente ${esc(short())}</b><span>Información y reservas</span></div><button class="icon-btn" type="button" data-act="chat-close" aria-label="Cerrar asistente">${I.x}</button></div>
      <div class="chat-log" id="chat-log" aria-live="polite">${log}</div>
      ${AS.salud ? '<p class="chat-disclaimer">No sustituye la valoración de un profesional sanitario.</p>' : ''}
      <form class="chat-form" id="chat-form"><label for="chat-in" class="sr-only">Escribe tu pregunta</label><input class="input" id="chat-in" autocomplete="off" placeholder="Escribe tu pregunta…"><button class="btn btn-brand btn-sm" type="submit" aria-label="Enviar">${I.send}</button></form>
    </section>`;
    const lg = $('#chat-log'); lg.scrollTop = lg.scrollHeight;
    $('#chat-form').addEventListener('submit', e => { e.preventDefault(); const v = $('#chat-in').value.trim(); if (v) ask(v); });
  }
  const focusInput = () => { const i = $('#chat-in'); if (i) i.focus(); };

  async function run(fn) {
    CH.typing = true; render();
    try { CFG = CFG || await API.config(); await fn(); }
    catch (e) { bot(`Ahora mismo no puedo consultar la agenda (${esc(e.message)}). Puedes llamarnos${CFG ? ': ' + esc(CFG.center.phone) : ''}.`); }
    CH.typing = false; render(); focusInput();
  }
  function ask(text) { user(text); run(() => answer(text)); }
  async function openChat(q) {
    CH.open = true;
    if (!CH.msgs.length) bot(AS.saludo || `Hola, soy el asistente de <b>${esc(SITE.negocio.nombre)}</b>. Te informo sobre servicios y horarios, y te ayudo a reservar.`, MAIN());
    render();
    if (q) ask(q); else focusInput();
  }

  actions['chat-open'] = () => openChat();
  actions['chat-ask'] = el => openChat(el.dataset.q);
  actions['chat-close'] = () => { CH.open = false; render(); const f = $('#chat-fab'); if (f) f.focus(); };
  actions['chat-act'] = el => {
    const k = el.dataset.k, v = el.dataset.v;
    if (k === 'ask') return ask(v);
    if (k === 'link' || k === 'go') { location.href = v; return; }
    user(el.textContent);
    if (k === 'flow') return run(() => (v === 'class' ? startClassFlow() : startFlow()));
    if (k === 'svc') return run(() => chooseService(v));
    if (k === 'sp') return run(() => chooseSpecialist(v));
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && CH.open) actions['chat-close'](); });
  window.CHAT = { open: openChat, ask, get state() { return CH; } };
})();
