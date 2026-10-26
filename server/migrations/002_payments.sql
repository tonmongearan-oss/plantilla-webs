-- Pago de señal online (Stripe) en las citas individuales reservadas desde la web.
ALTER TABLE appointments
  ADD COLUMN payment_status       text NOT NULL DEFAULT 'none'
    CHECK (payment_status IN ('none', 'pending', 'paid', 'refunded', 'expired')),
  ADD COLUMN payment_amount_cents integer CHECK (payment_amount_cents IS NULL OR payment_amount_cents >= 0),
  ADD COLUMN payment_session_id   text,
  ADD COLUMN payment_url          text,
  ADD COLUMN payment_intent_id    text,
  ADD COLUMN payment_expires_at   timestamptz,
  ADD COLUMN paid_at              timestamptz,
  ADD COLUMN refunded_at          timestamptz,
  ADD COLUMN refund_id            text;

CREATE INDEX appointments_payment_pending_idx ON appointments (payment_expires_at) WHERE payment_status = 'pending';
