-- ADR-052: automations dispatch moved onto the process-manager substrate
-- (ProcessManagerInbox/Instance/Outbox). The legacy ReactorOutbox audit
-- table has no readers left; in-flight rows at cutover are pending
-- notifications whose loss window the ADR accepts (minutes, alert-class).
DROP TABLE IF EXISTS "ReactorOutbox";
DROP TYPE IF EXISTS "ReactorOutboxStatus";
