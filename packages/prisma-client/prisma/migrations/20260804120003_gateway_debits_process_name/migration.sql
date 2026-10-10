-- Carry the gateway debits process manager's persisted rows onto its own name.
--
-- The process writes one budget ledger row per applicable budget for every
-- gateway request. It was registered under `attributedUserDebits`, the name of
-- the narrower thing it started as, and the code has been renamed to
-- `gatewayDebits` to match what it actually does.
--
-- The rename cannot be code-only. The process manager keys its instance, inbox
-- and outbox rows on the process name, and every lookup filters by it: the wake
-- scan only considers registered names, and the outbox lease reads
-- `WHERE processName IN (...)`. Rows left under the old name would therefore not
-- fail, they would go silently unread, and the outbox ones are pending money
-- intents. So they move rather than being orphaned.
--
-- Collision-free by construction: nothing has ever registered under
-- `gatewayDebits`, so no row can be updated onto an existing unique key. Each
-- table's unique index leads with processName, which is exactly why the update
-- is safe here and would not be if both names were in use.
--
-- One bounded gap remains, and it is accepted rather than solved: between this
-- migration running and the last old-code pod draining, those pods keep writing
-- rows under the old name, and any still pending when they stop are orphaned.
-- That window is seconds of drain lag, and the ClickHouse ledger's
-- ReplacingMergeTree key collapses anything written twice across the straddle.

UPDATE "ProcessManagerInstance" SET "processName" = 'gatewayDebits'
WHERE "processName" = 'attributedUserDebits';

UPDATE "ProcessManagerInbox" SET "processName" = 'gatewayDebits'
WHERE "processName" = 'attributedUserDebits';

UPDATE "ProcessManagerOutbox" SET "processName" = 'gatewayDebits'
WHERE "processName" = 'attributedUserDebits';

-- To roll back, uncomment and run manually. Reverses in the same order the
-- rows are read in, outbox first, so a pod picking work up mid-rollback sees
-- the pending money intents under the name its code is looking for.
-- UPDATE "ProcessManagerOutbox" SET "processName" = 'attributedUserDebits'
-- WHERE "processName" = 'gatewayDebits';
--
-- UPDATE "ProcessManagerInbox" SET "processName" = 'attributedUserDebits'
-- WHERE "processName" = 'gatewayDebits';
--
-- UPDATE "ProcessManagerInstance" SET "processName" = 'attributedUserDebits'
-- WHERE "processName" = 'gatewayDebits';
