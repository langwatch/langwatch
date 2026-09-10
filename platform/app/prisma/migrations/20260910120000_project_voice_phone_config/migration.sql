-- Per-project guardrails for phone (Twilio) voice targets (langwatch/langwatch#8014).
--
-- Holds the deny-by-default allowlist of E.164 destinations a phone target may
-- dial and an optional per-call duration cap. Nullable and absent by default,
-- so an existing project stays deny-by-default (no destination is dialable)
-- until an operator sets it. The Twilio account credentials themselves live in
-- the environment, never in this column. Mirrors the "langyEgressAllowlist"
-- Json? column's shape on the same table. Resolved by resolveVoicePhoneConfig.
ALTER TABLE "Project" ADD COLUMN "voicePhoneConfig" JSONB;
