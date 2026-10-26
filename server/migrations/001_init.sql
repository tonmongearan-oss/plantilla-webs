-- Esquema inicial de Postural Centro Sanitario.
-- Solo se guardan los datos imprescindibles para gestionar citas: nada de historia clínica.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ajustes del centro (datos de contacto, reglas de reserva, recordatorios)
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name         text NOT NULL,
  short        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 10 AND 480),
  price_eur    numeric(8,2) CHECK (price_eur IS NULL OR price_eur >= 0),
  active       boolean NOT NULL DEFAULT true,
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Cuentas de Google autorizadas (el refresh token se guarda cifrado con ENCRYPTION_KEY)
CREATE TABLE google_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE,
  refresh_token_enc  text NOT NULL,
  scopes             text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'revoked')),
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE specialists (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  role                  text NOT NULL DEFAULT '',
  bio                   text NOT NULL DEFAULT '',
  photo_url             text,
  color                 text NOT NULL DEFAULT 'sage',
  active                boolean NOT NULL DEFAULT true,
  slot_step_min         integer NOT NULL DEFAULT 30 CHECK (slot_step_min BETWEEN 5 AND 240),
  -- {"1":{"on":true,"blocks":[{"s":"09:00","e":"13:00"}],"breaks":[{"s":"11:00","e":"11:30"}]}, … "7":{…}}
  schedule              jsonb NOT NULL,
  -- [{"from":"2026-12-24","to":"2026-12-31","label":"Vacaciones"}]
  vacations             jsonb NOT NULL DEFAULT '[]',
  google_account_id     uuid REFERENCES google_accounts(id) ON DELETE SET NULL,
  google_calendar_id    text,
  google_calendar_name  text,
  sort                  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE specialist_services (
  specialist_id uuid NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  service_id    text NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (specialist_id, service_id)
);

CREATE TABLE patients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  phone                 text NOT NULL,          -- formato E.164: +34600123456
  email                 text NOT NULL,
  whatsapp_opt_in       boolean NOT NULL DEFAULT false,
  whatsapp_opt_in_at    timestamptz,
  whatsapp_opt_out_at   timestamptz,
  privacy_accepted_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_phone_idx ON patients (phone);
CREATE INDEX patients_email_idx ON patients (lower(email));

CREATE TABLE appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        text NOT NULL REFERENCES services(id),
  specialist_id     uuid NOT NULL REFERENCES specialists(id),
  patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text NOT NULL CHECK (status IN ('pendiente', 'confirmada', 'completada', 'cancelada')),
  source            text NOT NULL CHECK (source IN ('web', 'chatbot', 'panel', 'telefono')),
  manage_token_hash text UNIQUE,
  manage_token_enc  text,
  google_event_id   text,
  google_account_id uuid,                 -- cuenta y calendario donde está el evento
  google_calendar_id text,
  google_sync       text NOT NULL DEFAULT 'pending' CHECK (google_sync IN ('pending', 'synced', 'not_connected', 'error')),
  google_sync_error text,
  cancelled_at      timestamptz,
  cancelled_by      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Garantía en la base de datos: un especialista nunca tiene dos citas activas que se solapen,
  -- aunque lleguen dos reservas a la vez.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    specialist_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status <> 'cancelada')
);
CREATE INDEX appointments_starts_idx ON appointments (starts_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id);

CREATE TABLE class_types (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  published   boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0
);

-- Horario semanal de clases grupales
CREATE TABLE class_slots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_type_id  text NOT NULL REFERENCES class_types(id),
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  capacity       integer NOT NULL CHECK (capacity BETWEEN 1 AND 100),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CHECK (end_time > start_time)
);

CREATE TABLE class_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_slot_id     uuid NOT NULL REFERENCES class_slots(id),
  session_date      date NOT NULL,
  patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada', 'cancelada')),
  source            text NOT NULL CHECK (source IN ('web', 'chatbot', 'panel', 'telefono')),
  manage_token_hash text UNIQUE,
  manage_token_enc  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz
);
CREATE UNIQUE INDEX class_bookings_once ON class_bookings (class_slot_id, session_date, patient_id) WHERE status <> 'cancelada';
CREATE INDEX class_bookings_session_idx ON class_bookings (class_slot_id, session_date);

CREATE TABLE contact_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  phone       text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz
);

CREATE TABLE admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE sessions (
  id_hash     text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);

CREATE TABLE oauth_states (
  state          text PRIMARY KEY,
  specialist_id  uuid REFERENCES specialists(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at     timestamptz NOT NULL
);

-- Cola de tareas en segundo plano (Google Calendar, WhatsApp, mantenimiento)
CREATE TABLE jobs (
  id              bigserial PRIMARY KEY,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  run_at          timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  last_error      text,
  result          text,
  dedupe_key      text UNIQUE,
  appointment_id  uuid REFERENCES appointments(id) ON DELETE CASCADE,
  class_booking_id uuid REFERENCES class_bookings(id) ON DELETE CASCADE,
  locked_at       timestamptz,
  done_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE status = 'pending';
CREATE INDEX jobs_appointment_idx ON jobs (appointment_id);

-- Mensajes de WhatsApp enviados y su estado de entrega
CREATE TABLE notifications (
  id                   bigserial PRIMARY KEY,
  patient_id           uuid REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id       uuid REFERENCES appointments(id) ON DELETE CASCADE,
  class_booking_id     uuid REFERENCES class_bookings(id) ON DELETE CASCADE,
  kind                 text NOT NULL,
  provider             text NOT NULL,
  template             text NOT NULL,
  to_phone             text NOT NULL,
  status               text NOT NULL DEFAULT 'sent',
  provider_message_id  text,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_msg_idx ON notifications (provider_message_id);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  actor    text NOT NULL,
  action   text NOT NULL,
  details  jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
