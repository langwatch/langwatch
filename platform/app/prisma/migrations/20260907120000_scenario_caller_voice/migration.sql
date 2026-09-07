-- A scenario with a voice target carries the simulated caller's own voice:
-- the TTS voice model, the interrupt probability, and an audio effect. It
-- lives on the scenario (not the agent) because the same voice agent is phoned
-- by different personas across scenarios. Null means a non-voice scenario, or a
-- voice scenario that keeps every caller default. See caller-voice.config.ts.
--
-- Adding a nullable JSONB column with no default is a catalog change in
-- Postgres: no existing row is rewritten, so the lock is brief on a table of
-- any size.

ALTER TABLE "Scenario" ADD COLUMN "callerVoice" JSONB;

-- Down (manual rollback; uncomment and run):
-- ALTER TABLE "Scenario" DROP COLUMN "callerVoice";
