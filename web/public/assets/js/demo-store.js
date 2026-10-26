/* =====================================================================
   PosturalStore (SOLO DEMO, sin servidor) — capa de datos única para la web pública y el panel.
   Toda la lógica de servicios, especialistas, reservas individuales,
   clases grupales y pacientes vive aquí. La persistencia actual es
   localStorage (demo); para producción basta con sustituir el
   adaptador `persist` por llamadas a un backend con la misma forma.
   ===================================================================== */
(function (global) {
  'use strict';

  const KEY = 'postural-demo-v2';
  const VERSION = 4;

  const E = global.PosturalEngine;
  const { dk, parseDk, addDays, isoWd, tmin, fmt, overlaps, nowMin, uid, clone, norm, mondayOf, DAY_NAMES, DAY_SHORT, MONTHS, STATUS,
    getService, getSpecialist, getPatient, getClassType, getTemplate, specialistsFor, dayPlan, activeBookings, slotsFor, serviceSlots,
    dayStatus, nextAvailable, nextAvailableAny, validateIndividual, classSessions, patientByEmail, patientStats } = E;

  /* ---------- datos base (contenido real de la web del centro) ---------- */
  function baseServices() {
    return [
      { id: 'valoracion', name: 'Valoración inicial', duration: 60, price: null, active: true,
        short: 'Tu primera visita: estudiamos tu caso y te proponemos un plan.',
        description: 'Valoración exhaustiva por un fisioterapeuta: anamnesis (antecedentes, estado actual, síntomas y dolor), exploración física con estudio biomecánico y postural, tratamiento en camilla y plan de rehabilitación específico.' },
      { id: 'fisio', name: 'Fisioterapia', duration: 45, price: null, active: true,
        short: 'Sesiones en camilla para lesiones de rodilla, hombro, cadera o espalda.',
        description: 'Sesiones de fisioterapia en camilla para cualquier tipo de lesión. Se plantean como complemento de la Educación Postural para tratar contracturas y tensiones concretas.' },
      { id: 'rehab', name: 'Rehabilitación específica', duration: 60, price: null, active: true,
        short: 'Recuperación de patologías de columna, con o sin cirugía.',
        description: 'Tras una valoración inicial, plan de rehabilitación adaptado al paciente que combina, si es necesario, terapias pasivas con ejercicios musculares y posturales.' },
      { id: 'dolor', name: 'Tratamiento del dolor', duration: 45, price: null, active: true,
        short: 'Consulta con la Médico Rehabilitador Dra. Emilia Pérez.',
        description: 'Consulta con la Médico Rehabilitador Dra. Emilia Pérez, experta en Terapia Neural, acupuntura y auriculoterapia, que colabora con el centro.' },
      { id: 'entreno', name: 'Entrenamiento personal', duration: 60, price: null, active: true,
        short: 'Un programa solo para ti, en el horario que mejor te va.',
        description: 'Para recuperar movilidad, tono y flexibilidad, recuperarse de una lesión o seguir un programa personalizado cuando una clase grupal no es lo adecuado.' },
      { id: 'bruxismo', name: 'Bruxismo', duration: 45, price: null, active: true,
        short: 'Fisioterapeuta y odontólogo trabajando juntos.',
        description: 'Abordaje combinado entre odontólogo y fisioterapeuta, junto con terapia activa y autocuidado.' }
    ];
  }

  function wk(days, blocks, breaks) {
    const s = {};
    for (let i = 1; i <= 7; i++) s[i] = { on: false, blocks: [], breaks: [] };
    for (const d of days) s[d] = { on: true, blocks: clone(blocks), breaks: clone(breaks || []) };
    return s;
  }

  function baseSpecialists(today) {
    const marc = wk([2, 4], [{ s: '16:00', e: '20:00' }], [{ s: '18:00', e: '18:30' }]);
    marc[3] = { on: true, blocks: [{ s: '09:00', e: '13:00' }], breaks: [] };
    marc[5] = { on: true, blocks: [{ s: '15:00', e: '19:00' }], breaks: [] };
    // vacaciones de ejemplo relativas a la fecha en que se abre la demo
    const nextMon = addDays(mondayOf(today), 14);
    return [
      { id: 'sp_laura', name: 'Laura Vidal', demo: true, color: 'sage', photo: null,
        role: 'Fisioterapeuta · columna y educación postural',
        bio: 'Perfil de demostración editable. Sustituir por el nombre, la foto y la trayectoria reales del profesional.',
        serviceIds: ['valoracion', 'fisio', 'rehab', 'bruxismo'], active: true, slotStep: 30,
        schedule: wk([1, 2, 3, 4], [{ s: '09:00', e: '13:00' }], [{ s: '11:00', e: '11:30' }]),
        vacations: [{ from: nextMon, to: addDays(nextMon, 1), label: 'Vacaciones' }] },
      { id: 'sp_marc', name: 'Marc Soler', demo: true, color: 'blue', photo: null,
        role: 'Fisioterapeuta · rehabilitación postquirúrgica',
        bio: 'Perfil de demostración editable. Horario de tardes y miércoles por la mañana.',
        serviceIds: ['valoracion', 'fisio', 'rehab'], active: true, slotStep: 30,
        schedule: marc, vacations: [] },
      { id: 'sp_nuria', name: 'Núria Prat', demo: true, color: 'sand', photo: null,
        role: 'Entrenadora personal · readaptación',
        bio: 'Perfil de demostración editable. Trabaja lunes, miércoles y viernes, mañana y tarde.',
        serviceIds: ['entreno', 'rehab'], active: true, slotStep: 30,
        schedule: wk([1, 3, 5], [{ s: '09:30', e: '13:30' }, { s: '17:00', e: '20:00' }], []), vacations: [] },
      { id: 'sp_alex', name: 'Àlex Ferrer', demo: true, color: 'plum', photo: null,
        role: 'Fisioterapeuta · lesiones deportivas',
        bio: 'Perfil de demostración editable. Solo tardes, con citas cada 45 minutos.',
        serviceIds: ['fisio', 'entreno', 'valoracion'], active: true, slotStep: 45,
        schedule: wk([1, 2, 3, 4, 5], [{ s: '17:00', e: '21:00' }], []), vacations: [] },
      { id: 'sp_emilia', name: 'Dra. Emilia Pérez', demo: false, exampleSchedule: true, color: 'teal', photo: null,
        role: 'Médico Rehabilitador · Terapia Neural, acupuntura y auriculoterapia',
        bio: 'Licenciada en Medicina y Cirugía por la Universidad Autónoma de Barcelona (1982) y Máster en Terapia Neural por la Universidad de Barcelona. Colabora con Postural en el tratamiento del dolor.',
        serviceIds: ['dolor'], active: true, slotStep: 45,
        schedule: wk([4], [{ s: '10:00', e: '13:00' }], []), vacations: [] }
    ];
  }

  function baseClassTypes() {
    return [
      { id: 'especial', name: 'Postural Especial', published: true,
        text: 'Para pacientes en fase de dolor o en rehabilitación postquirúrgica, y personas de edad avanzada con movilidad limitada.' },
      { id: 'postural', name: 'Postural', published: true,
        text: 'Para quien ya ha pasado la fase postoperatoria y para personas de hábitos sedentarios que necesitan ganar movilidad articular, estiramiento y tono.' },
      { id: 'avanzado', name: 'Postural Avanzado', published: true,
        text: 'Para personas sin dolor, jóvenes o con capacidad física elevada. Cambia la dificultad de los ejercicios, la duración de las posiciones y las repeticiones.' },
      { id: 'tono', name: 'Postural Tono', published: true,
        text: 'Para deportistas y quien quiere mejorar su tono. Ejercicios de fuerza y resistencia por grupos musculares, partiendo de la educación postural.' },
      { id: 'juvenil', name: 'Postural Juvenil', published: false,
        text: 'Aparece en el horario publicado. Descripción pendiente de confirmar con el centro.' },
      { id: 'tonificacion', name: 'Tonificación', published: false,
        text: 'Aparece en el horario publicado. Descripción pendiente de confirmar con el centro.' }
    ];
  }

  // Horario de clases publicado en posturalcentrosanitario.com/horarios (referencia inicial)
  const PUBLISHED = {
    1: [['postural', '08:30'], ['avanzado', '09:30'], ['especial', '10:30'], ['especial', '17:00'], ['postural', '18:00'], ['avanzado', '19:00'], ['tono', '20:00']],
    2: [['postural', '08:30'], ['avanzado', '09:30'], ['especial', '10:30'], ['especial', '11:30'], ['postural', '17:00'], ['especial', '17:00'], ['postural', '18:00'], ['juvenil', '18:00'], ['avanzado', '19:00'], ['tono', '19:00'], ['postural', '20:00']],
    3: [['postural', '08:30'], ['avanzado', '09:30'], ['especial', '10:30'], ['especial', '17:00'], ['postural', '18:00'], ['avanzado', '19:00'], ['tonificacion', '20:00']],
    4: [['postural', '08:30'], ['avanzado', '09:30'], ['especial', '10:30'], ['especial', '11:30'], ['postural', '17:00'], ['especial', '17:00'], ['postural', '18:00'], ['juvenil', '18:00'], ['avanzado', '19:00'], ['tono', '19:00'], ['postural', '20:00']],
    5: [['tono', '09:30'], ['tono', '10:30'], ['postural', '17:00'], ['postural', '18:00'], ['postural', '19:00']]
  };

  function baseClassTemplates() {
    const out = [];
    for (const wd of Object.keys(PUBLISHED)) {
      PUBLISHED[wd].forEach(([typeId, start], i) => {
        out.push({ id: `cl_${wd}_${i}`, typeId, weekday: Number(wd), start, end: fmt(tmin(start) + 60),
          capacity: typeId === 'especial' ? 8 : 12, active: true });
      });
    }
    return out;
  }

  const FIRST = ['Marta', 'Jordi', 'Elena', 'Pau', 'Carmen', 'Javier', 'Montse', 'Sergio', 'Lucía', 'Albert', 'Rosa', 'David', 'Anna', 'Miguel', 'Cristina', 'Oriol', 'Pilar', 'Raúl', 'Sílvia', 'Andrés', 'Teresa', 'Marc', 'Isabel', 'Víctor', 'Laia', 'Francisco', 'Eva', 'Joan', 'Beatriz', 'Toni', 'Mercè', 'Óscar', 'Irene', 'Ramón', 'Nerea', 'Enric'];
  const LAST = ['García', 'Puig', 'Martínez', 'Roca', 'López', 'Serra', 'Sánchez', 'Vila', 'Fernández', 'Font', 'Moreno', 'Casas', 'Romero', 'Pons', 'Navarro', 'Bosch', 'Ruiz', 'Mas', 'Ortega', 'Riera'];

  function mulberry(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* ---------- mutaciones (siempre dentro de commit) ---------- */
  function log(st, text) { st.log.unshift({ ts: new Date().toISOString(), text }); st.log = st.log.slice(0, 60); }

  function ensurePatient(st, p) {
    if (p.patientId) { const ex = getPatient(st, p.patientId); if (!ex) throw new Error('El paciente seleccionado no existe.'); return ex; }
    const name = String(p.name || '').trim(), email = String(p.email || '').trim(), phone = String(p.phone || '').trim();
    if (name.length < 3) throw new Error('Indica nombre y apellidos.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indica un correo electrónico válido.');
    if (phone.replace(/\D/g, '').length < 9) throw new Error('Indica un teléfono de al menos 9 cifras.');
    let ex = patientByEmail(st, email);
    if (ex) { ex.name = name; ex.phone = phone; return ex; }
    ex = { id: uid('pt'), name, email, phone, createdAt: new Date().toISOString(), demo: true };
    st.patients.push(ex);
    return ex;
  }

  function createBooking(st, data, opts) {
    opts = opts || {};
    const svc = getService(st, data.serviceId);
    const b = { serviceId: data.serviceId, specialistId: data.specialistId, date: data.date, start: data.start, duration: data.duration || (svc && svc.duration) };
    const err = validateIndividual(st, b, opts);
    if (err) throw new Error(err);
    const pt = ensurePatient(st, data);
    const booking = { id: uid('bk'), kind: 'individual', ...b, patientId: pt.id, status: data.status || 'pendiente', source: data.source || 'web', createdAt: new Date().toISOString() };
    st.bookings.push(booking);
    const sp = getSpecialist(st, b.specialistId);
    log(st, `Nueva cita (${sourceLabel(booking.source)}): ${pt.name} · ${svc.name} con ${sp.name} · ${b.date} ${b.start}`);
    return booking;
  }

  function sourceLabel(s) { return s === 'web' ? 'web' : s === 'chatbot' ? 'asistente web' : 'panel'; }

  function setBookingStatus(st, id, status) {
    const b = st.bookings.find(x => x.id === id);
    if (!b) throw new Error('La cita no existe.');
    if (b.status === 'cancelada' && status !== 'cancelada') {
      const err = validateIndividual(st, b, { ignoreId: b.id, allowPast: true, allowInactive: true });
      if (err) throw new Error('No se puede reactivar: ' + err);
    }
    b.status = status;
    const pt = getPatient(st, b.patientId);
    log(st, `Cita ${STATUS[status].toLowerCase()}: ${pt ? pt.name : 'paciente'} · ${b.date} ${b.start}`);
    return b;
  }

  function bookClass(st, data, opts) {
    opts = opts || {};
    const t = getTemplate(st, data.templateId);
    if (!t || !t.active) throw new Error('Esta clase no está disponible.');
    if (isoWd(data.date) !== t.weekday) throw new Error('La clase no se imparte ese día.');
    const ses = classSessions(st, data.date, opts).find(s => s.template.id === t.id);
    if (!ses) throw new Error('Esta clase no está disponible.');
    if (ses.past && !opts.allowPast) throw new Error('Esta clase ya ha empezado.');
    if (ses.full) throw new Error('Clase completa: se ha alcanzado el aforo máximo.');
    const pt = ensurePatient(st, data);
    if (st.classBookings.some(c => c.templateId === t.id && c.date === data.date && c.patientId === pt.id && c.status !== 'cancelada')) throw new Error('Esta persona ya tiene plaza en esta clase.');
    const cb = { id: uid('cb'), kind: 'class', templateId: t.id, date: data.date, patientId: pt.id, status: data.status || 'confirmada', source: data.source || 'web', createdAt: new Date().toISOString() };
    st.classBookings.push(cb);
    const ty = getClassType(st, t.typeId);
    log(st, `Plaza reservada (${sourceLabel(cb.source)}): ${pt.name} · ${ty.name} ${data.date} ${t.start} (${ses.taken + 1}/${ses.capacity})`);
    return cb;
  }

  function cancelClassBooking(st, id) {
    const c = st.classBookings.find(x => x.id === id);
    if (!c) throw new Error('La plaza no existe.');
    c.status = 'cancelada';
    const pt = getPatient(st, c.patientId);
    log(st, `Plaza cancelada: ${pt ? pt.name : 'paciente'} · ${c.date}`);
  }

  /* ---------- semilla de demostración ---------- */
  function seed(now) {
    now = now || new Date();
    const today = dk(now);
    const rnd = mulberry(20261021);
    const st = {
      version: VERSION,
      seededOn: today,
      center: {
        name: 'Postural Centro Sanitario',
        phone: '639 71 15 17',
        email: 'postural@posturalcentrosanitario.com',
        address: 'Avinguda de la Constitució 89',
        city: '08860 Castelldefels, Barcelona',
        publicHours: 'Lunes a viernes, de 9:30 a 12:30 y de 17:00 a 20:00',
        registry: 'E 08703726'
      },
      settings: { minNoticeMinutes: 60, bookingHorizonDays: 60, defaultCapacity: 12 },
      services: baseServices(),
      specialists: baseSpecialists(today),
      classTypes: baseClassTypes(),
      classTemplates: baseClassTemplates(),
      patients: [], bookings: [], classBookings: [], messages: [], log: []
    };
    // pacientes ficticios
    const used = new Set();
    while (st.patients.length < 42) {
      const f = FIRST[Math.floor(rnd() * FIRST.length)], l = LAST[Math.floor(rnd() * LAST.length)], l2 = LAST[Math.floor(rnd() * LAST.length)];
      const name = `${f} ${l} ${l2}`;
      if (used.has(f + l) || l === l2) continue;
      used.add(f + l);
      const email = `${norm(f)}.${norm(l)}@ejemplo.com`.replace(/\s/g, '');
      const phone = `600 ${String(100 + Math.floor(rnd() * 899))} ${String(100 + Math.floor(rnd() * 899))}`;
      st.patients.push({ id: `pt_${st.patients.length + 1}`, name, email, phone, createdAt: addDays(today, -Math.floor(rnd() * 400)) + 'T10:00:00.000Z', demo: true });
    }
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const far = new Date(2000, 0, 1);
    // citas individuales
    for (let off = -21; off <= 21; off++) {
      const date = addDays(today, off);
      for (const sp of st.specialists) {
        const p = off < 0 ? 0.55 : off <= 7 ? 0.36 : off <= 14 ? 0.24 : 0.12;
        let guard = 0;
        while (guard++ < 30) {
          const svcId = pick(sp.serviceIds);
          const svc = getService(st, svcId);
          const { slots } = slotsFor(st, sp.id, date, svc.duration, { now: far, ignoreNotice: true });
          const free = slots.filter(s => s.status === 'available');
          if (!free.length) break;
          const fill = slots.filter(s => s.status === 'booked').length / Math.max(1, slots.length);
          if (fill >= p) break;
          const s = pick(free);
          const isPast = date < today || (date === today && s.min < nowMin(now));
          let status = isPast ? (rnd() < 0.08 ? 'cancelada' : 'completada') : (off <= 10 && rnd() < 0.1 ? 'pendiente' : 'confirmada');
          st.bookings.push({ id: uid('bk'), kind: 'individual', serviceId: svcId, specialistId: sp.id, date, start: s.start, duration: svc.duration,
            patientId: pick(st.patients).id, status, source: rnd() < 0.4 ? 'web' : 'panel', createdAt: addDays(date, -3) + 'T09:00:00.000Z' });
        }
      }
    }
    // plazas en clases grupales
    let fullDone = false, almostDone = false;
    for (let off = -7; off <= 14; off++) {
      const date = addDays(today, off);
      for (const ses of classSessions(st, date, { now: far })) {
        let target = Math.floor(ses.capacity * (0.35 + rnd() * 0.5));
        const upcoming = date > today;
        if (upcoming && !fullDone && ses.template.typeId === 'especial') { target = ses.capacity; fullDone = true; }
        else if (upcoming && fullDone && !almostDone && ses.template.typeId === 'postural') { target = ses.capacity - 1; almostDone = true; }
        const pool = st.patients.slice().sort(() => rnd() - 0.5);
        for (let i = 0; i < target && i < pool.length; i++) {
          st.classBookings.push({ id: uid('cb'), kind: 'class', templateId: ses.template.id, date, patientId: pool[i].id, status: 'confirmada', source: rnd() < 0.5 ? 'web' : 'panel', createdAt: addDays(date, -4) + 'T09:00:00.000Z' });
        }
      }
    }
    st.log = [
      { ts: new Date(now.getTime() - 3600e3).toISOString(), text: 'Datos de demostración cargados (pacientes y citas ficticios).' }
    ];
    return st;
  }

  /* ---------- persistencia + suscripción ---------- */
  const persist = {
    ok: true,
    read() { try { const raw = global.localStorage && global.localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { this.ok = false; return null; } },
    write(st) { try { global.localStorage && global.localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { this.ok = false; } },
    clear() { try { global.localStorage && global.localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ } }
  };

  let state = null;
  const listeners = new Set();

  function load() {
    const saved = persist.read();
    if (saved && saved.version === VERSION) state = saved;
    else { state = seed(); persist.write(state); }
    return state;
  }

  function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

  /** Aplica una mutación sobre la versión más reciente guardada (evita
   *  pisar reservas hechas en otra pestaña) y la valida antes de guardar. */
  function commit(mutator) {
    const fresh = persist.read();
    const base = fresh && fresh.version === VERSION ? fresh : state;
    const draft = clone(base);
    const result = mutator(draft);
    state = draft;
    persist.write(state);
    emit();
    return result;
  }

  if (global.addEventListener) {
    global.addEventListener('storage', e => { if (e.key === KEY) { const s = persist.read(); if (s && s.version === VERSION) { state = s; emit(); } } });
  }

  const api = {
    // ciclo de vida
    load, get state() { return state; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { state = seed(); persist.write(state); emit(); },
    storageOk: () => persist.ok,
    // consultas
    getService: id => getService(state, id), getSpecialist: id => getSpecialist(state, id), getPatient: id => getPatient(state, id),
    getClassType: id => getClassType(state, id), getTemplate: id => getTemplate(state, id),
    specialistsFor: id => specialistsFor(state, id),
    dayPlan, slotsFor: (spId, date, dur, o) => slotsFor(state, spId, date, dur, o),
    serviceSlots: (spId, svcId, date, o) => serviceSlots(state, spId, svcId, date, o),
    dayStatus: (spId, svcId, date, o) => dayStatus(state, spId, svcId, date, o),
    nextAvailable: (spId, svcId, n, o) => nextAvailable(state, spId, svcId, n, o),
    nextAvailableAny: (svcId, ids, n, o) => nextAvailableAny(state, svcId, ids, n, o),
    validate: (b, o) => validateIndividual(state, b, o),
    classSessions: (date, o) => classSessions(state, date, o),
    patientStats: (pid, o) => patientStats(state, pid, o),
    // mutaciones
    createBooking: (data, o) => commit(st => createBooking(st, data, o)),
    setBookingStatus: (id, status) => commit(st => setBookingStatus(st, id, status)),
    cancelBooking: id => commit(st => setBookingStatus(st, id, 'cancelada')),
    bookClass: (data, o) => commit(st => bookClass(st, data, o)),
    cancelClassBooking: id => commit(st => cancelClassBooking(st, id)),
    savePatient(p) {
      return commit(st => {
        const name = String(p.name || '').trim();
        if (name.length < 3) throw new Error('Indica nombre y apellidos.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email || '')) throw new Error('Indica un correo electrónico válido.');
        if (String(p.phone || '').replace(/\D/g, '').length < 9) throw new Error('Indica un teléfono de al menos 9 cifras.');
        const dup = patientByEmail(st, p.email);
        if (dup && dup.id !== p.id) throw new Error('Ya existe un paciente con ese correo.');
        if (p.id) { const ex = getPatient(st, p.id); Object.assign(ex, { name, email: p.email.trim(), phone: p.phone.trim() }); log(st, `Paciente actualizado: ${name}`); return ex; }
        const np = { id: uid('pt'), name, email: p.email.trim(), phone: p.phone.trim(), createdAt: new Date().toISOString(), demo: true };
        st.patients.push(np); log(st, `Paciente creado: ${name}`); return np;
      });
    },
    deletePatient(id) {
      return commit(st => {
        const p = getPatient(st, id); if (!p) return;
        st.patients = st.patients.filter(x => x.id !== id);
        st.bookings = st.bookings.filter(b => b.patientId !== id);
        st.classBookings = st.classBookings.filter(b => b.patientId !== id);
        log(st, `Paciente eliminado: ${p.name} (y sus reservas de demostración)`);
      });
    },
    saveSpecialist(sp) {
      return commit(st => {
        if (String(sp.name || '').trim().length < 3) throw new Error('Indica el nombre del especialista.');
        for (let d = 1; d <= 7; d++) {
          const day = sp.schedule[d];
          if (!day || !day.on) continue;
          for (const b of day.blocks) if (b.s && b.e && tmin(b.e) <= tmin(b.s)) throw new Error(`${DAY_NAMES[d]}: la hora de fin debe ser posterior a la de inicio.`);
          for (const b of day.breaks) if (b.s && b.e && tmin(b.e) <= tmin(b.s)) throw new Error(`${DAY_NAMES[d]}: el descanso termina antes de empezar.`);
        }
        for (const v of sp.vacations || []) if (v.from && v.to && v.to < v.from) throw new Error('Unas vacaciones terminan antes de empezar.');
        const i = st.specialists.findIndex(x => x.id === sp.id);
        const clean = clone(sp); clean.name = clean.name.trim();
        if (i >= 0) { st.specialists[i] = clean; log(st, `Horario o ficha actualizada: ${clean.name}`); }
        else { clean.id = clean.id || uid('sp'); st.specialists.push(clean); log(st, `Especialista añadido: ${clean.name}`); }
        return clean;
      });
    },
    deleteSpecialist(id) {
      return commit(st => {
        const sp = getSpecialist(st, id); if (!sp) return;
        st.specialists = st.specialists.filter(x => x.id !== id);
        st.bookings.forEach(b => { if (b.specialistId === id && b.status !== 'completada') b.status = 'cancelada'; });
        log(st, `Especialista eliminado: ${sp.name} (sus citas pendientes se han cancelado)`);
      });
    },
    saveService(svc, specialistIds) {
      return commit(st => {
        if (String(svc.name || '').trim().length < 3) throw new Error('Indica el nombre del servicio.');
        if (!(Number(svc.duration) >= 10)) throw new Error('La duración mínima es de 10 minutos.');
        const i = st.services.findIndex(s => s.id === svc.id);
        const clean = { ...svc, name: svc.name.trim(), duration: Number(svc.duration), price: svc.price === '' || svc.price == null ? null : Number(svc.price) };
        if (i >= 0) st.services[i] = clean; else { clean.id = clean.id || uid('sv'); st.services.push(clean); }
        if (specialistIds) st.specialists.forEach(sp => {
          const has = sp.serviceIds.includes(clean.id), want = specialistIds.includes(sp.id);
          if (want && !has) sp.serviceIds.push(clean.id);
          if (!want && has) sp.serviceIds = sp.serviceIds.filter(x => x !== clean.id);
        });
        log(st, `Servicio actualizado: ${clean.name}`);
        return clean;
      });
    },
    saveClassTemplate(t) {
      return commit(st => {
        if (!getClassType(st, t.typeId)) throw new Error('Elige una modalidad.');
        if (!(tmin(t.end) > tmin(t.start))) throw new Error('La clase debe terminar después de empezar.');
        if (!(Number(t.capacity) >= 1)) throw new Error('El aforo mínimo es 1 plaza.');
        const clean = { ...t, weekday: Number(t.weekday), capacity: Number(t.capacity) };
        const i = st.classTemplates.findIndex(x => x.id === t.id);
        if (i >= 0) st.classTemplates[i] = clean; else { clean.id = uid('cl'); st.classTemplates.push(clean); }
        log(st, `Horario de clase actualizado: ${getClassType(st, clean.typeId).name} ${DAY_NAMES[clean.weekday]} ${clean.start}`);
        return clean;
      });
    },
    deleteClassTemplate(id) {
      return commit(st => {
        st.classTemplates = st.classTemplates.filter(t => t.id !== id);
        st.classBookings.forEach(c => { if (c.templateId === id) c.status = 'cancelada'; });
        log(st, 'Clase eliminada del horario (sus plazas se han cancelado).');
      });
    },
    saveCenter(c, settings) { return commit(st => { Object.assign(st.center, c); if (settings) Object.assign(st.settings, settings); log(st, 'Datos del centro actualizados.'); }); },
    addMessage(m) {
      return commit(st => {
        if (String(m.name || '').trim().length < 2) throw new Error('Indica tu nombre.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email || '')) throw new Error('Indica un correo electrónico válido.');
        if (String(m.text || '').trim().length < 10) throw new Error('Escribe un mensaje de al menos 10 caracteres.');
        const msg = { id: uid('ms'), name: m.name.trim(), email: m.email.trim(), phone: (m.phone || '').trim(), text: m.text.trim(), createdAt: new Date().toISOString() };
        st.messages.unshift(msg); log(st, `Mensaje de contacto de ${msg.name}`); return msg;
      });
    },
    // utilidades expuestas
    util: { dk, parseDk, addDays, isoWd, tmin, fmt, overlaps, norm, mondayOf, DAY_NAMES, DAY_SHORT, MONTHS, STATUS, uid, clone }
  };

  /* Cambio de hora (demo) */
  api.rescheduleBooking = (id, date, start, opts) => commit(st => {
    const b = st.bookings.find(x => x.id === id);
    if (!b) throw new Error('La cita no existe.');
    if (b.status === 'cancelada' || b.status === 'completada') throw new Error('Esta cita ya no se puede cambiar.');
    const err = validateIndividual(st, { serviceId: b.serviceId, specialistId: b.specialistId, date, start, duration: b.duration }, { ignoreId: b.id, ...(opts || {}) });
    if (err) throw new Error(err);
    b.date = date; b.start = start;
    const pt = getPatient(st, b.patientId);
    log(st, `Cita cambiada: ${pt ? pt.name : 'paciente'} · ${date} ${start}`);
    return b;
  });
  api.markMessageHandled = id => commit(st => { const m = st.messages.find(x => x.id === id); if (m) m.handledAt = new Date().toISOString(); });

  global.PosturalStore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
