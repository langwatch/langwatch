-- The cost rollup comparator no longer keeps a calendar entry.
--
-- Its daily check is now driven by the `costRollupWatch` process manager on
-- the pulled-usage pipeline: a pulled charge arms a per-tenant wake, and the
-- wake emits one compare intent per touched day. Nothing registers a handler
-- for this targetType any more, so every row left behind would make the
-- scheduler claim a slot, find no handler registered, and log the same
-- warning once a day per tenant for as long as the row exists.
--
-- The rows carry no data of their own: a schedule is re-derivable, and this
-- one is not re-derived because the process replaces it.
DELETE FROM "ScheduledJob" WHERE "targetType" = 'governanceCostRollupComparator';

-- Down
--
-- Nothing to undo. The entries were minted at worker boot by a reconciler
-- this change deletes, so rolling the code back re-creates them on the next
-- boot without any statement here.
