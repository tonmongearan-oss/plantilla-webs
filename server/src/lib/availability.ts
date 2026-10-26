/* Motor de disponibilidad (funciones puras, sin base de datos).
   Calcula los huecos de un especialista en un día según su horario, pausas,
   vacaciones, citas ya reservadas y eventos ocupados de su Google Calendar. */
import { isoWeekday, tmin, fmt } from './time.ts';

export type Block = { s: string; e: string };
export type DaySchedule = { on: boolean; blocks: Block[]; breaks: Block[] };
export type Schedule = Record<string, DaySchedule>;
export type Vacation = { from: string; to: string; label?: string };
export type SpecialistAvail = { active: boolean; slotStep: number; schedule: Schedule; vacations: Vacation[] };
/** Intervalo ocupado en minutos del día local [s, e). */
export type Busy = { s: number; e: number; kind: 'booking' | 'external'; id?: string };
export type SlotStatus = 'available' | 'booked' | 'break' | 'unavailable' | 'past';
export type Slot = { start: string; min: number; status: SlotStatus; busyKind?: Busy['kind']; bookingId?: string };
export type DayPlan = { working: boolean; reason?: 'inactive' | 'vacation' | 'off'; label?: string; blocks: [number, number][]; breaks: [number, number][] };

export const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;

export function dayPlan(sp: SpecialistAvail, date: string): DayPlan {
  if (!sp.active) return { working: false, reason: 'inactive', blocks: [], breaks: [] };
  const vac = (sp.vacations || []).find(v => v.from && v.to && date >= v.from && date <= v.to);
  if (vac) return { working: false, reason: 'vacation', label: vac.label || 'Vacaciones', blocks: [], breaks: [] };
  const day = sp.schedule[String(isoWeekday(date))];
  if (!day || !day.on) return { working: false, reason: 'off', blocks: [], breaks: [] };
  const toPair = (b: Block): [number, number] => [tmin(b.s), tmin(b.e)];
  const blocks = (day.blocks || []).filter(b => b.s && b.e).map(toPair).filter(b => b[1] > b[0]).sort((a, b) => a[0] - b[0]);
  if (!blocks.length) return { working: false, reason: 'off', blocks: [], breaks: [] };
  const breaks = (day.breaks || []).filter(b => b.s && b.e).map(toPair).filter(b => b[1] > b[0]);
  return { working: true, blocks, breaks };
}

export type SlotOpts = { today: string; nowMin: number; noticeMin: number; ignoreNotice?: boolean };

export function daySlots(sp: SpecialistAvail, date: string, duration: number, busy: Busy[], o: SlotOpts): { plan: DayPlan; slots: Slot[] } {
  const plan = dayPlan(sp, date);
  if (!plan.working) return { plan, slots: [] };
  const step = Math.max(5, sp.slotStep || 30);
  const dur = Math.max(5, duration || step);
  const limit = o.nowMin + (o.ignoreNotice ? 0 : o.noticeMin);
  const pastDay = date < o.today;
  const slots: Slot[] = [];
  for (const [bs, be] of plan.blocks) {
    for (let t = bs; t < be; t += step) {
      const brk = plan.breaks.find(br => t >= br[0] && t < br[1]);
      const occ = busy.find(x => overlaps(t, t + Math.min(step, be - t), x.s, x.e));
      let slot: Slot;
      if (brk) slot = { start: fmt(t), min: t, status: 'break' };
      else if (occ) slot = { start: fmt(t), min: t, status: 'booked', busyKind: occ.kind, bookingId: occ.kind === 'booking' ? occ.id : undefined };
      else {
        const ok = t + dur <= be && !plan.breaks.some(br => overlaps(t, t + dur, br[0], br[1])) && !busy.some(x => overlaps(t, t + dur, x.s, x.e));
        let status: SlotStatus = ok ? 'available' : 'unavailable';
        if (status === 'available' && (pastDay || (date === o.today && t < limit))) status = 'past';
        slot = { start: fmt(t), min: t, status };
      }
      slots.push(slot);
    }
  }
  return { plan, slots };
}

/** Comprueba si una cita concreta cabe. Devuelve un mensaje de error o null. */
export function checkFits(sp: SpecialistAvail & { name: string }, date: string, start: string, duration: number, busy: Busy[]): string | null {
  const plan = dayPlan(sp, date);
  if (!plan.working) {
    if (plan.reason === 'vacation') return `${sp.name} está de vacaciones ese día.`;
    if (plan.reason === 'inactive') return `${sp.name} no tiene agenda disponible en este momento.`;
    return `${sp.name} no trabaja ese día.`;
  }
  const s = tmin(start), e = s + duration;
  if (!plan.blocks.some(([bs, be]) => s >= bs && e <= be)) return 'La cita no cabe dentro del horario de trabajo del especialista.';
  if (plan.breaks.some(([bs, be]) => overlaps(s, e, bs, be))) return 'La cita coincide con un descanso del especialista.';
  const clash = busy.find(x => overlaps(s, e, x.s, x.e));
  if (clash) return clash.kind === 'external'
    ? 'Ese horario está ocupado en la agenda del especialista. Elige otra hora.'
    : 'Este horario ya está reservado. Elige otra hora.';
  return null;
}

/** Valida y normaliza un horario semanal recibido del panel. */
export function normalizeSchedule(input: unknown): Schedule | string {
  if (!input || typeof input !== 'object') return 'Horario no válido.';
  const names = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const isT = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const out: Schedule = {};
  for (let d = 1; d <= 7; d++) {
    const raw = (input as Record<string, any>)[String(d)] || {};
    const clean = (arr: unknown): Block[] => (Array.isArray(arr) ? arr : []).filter((b: any) => b && b.s && b.e).slice(0, 4).map((b: any) => ({ s: String(b.s), e: String(b.e) }));
    const blocks = clean(raw.blocks), breaks = clean(raw.breaks);
    for (const b of [...blocks, ...breaks]) {
      if (!isT(b.s) || !isT(b.e)) return `${names[d]}: formato de hora no válido.`;
      if (tmin(b.e) <= tmin(b.s)) return `${names[d]}: la hora de fin debe ser posterior a la de inicio.`;
    }
    out[String(d)] = { on: !!raw.on && blocks.length > 0, blocks, breaks };
  }
  return out;
}

export function normalizeVacations(input: unknown): Vacation[] | string {
  if (!Array.isArray(input)) return [];
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const out: Vacation[] = [];
  for (const v of input.slice(0, 50)) {
    if (!v || !re.test(v.from) || !re.test(v.to)) continue;
    if (v.to < v.from) return 'Un periodo de vacaciones termina antes de empezar.';
    out.push({ from: v.from, to: v.to, label: String(v.label || 'Vacaciones').slice(0, 60) });
  }
  return out;
}
