-- The phase of a budget's cyclic window.
--
-- Until now every cyclic window was calendar aligned: a MONTH budget started
-- on the 1st, a WEEK budget on Monday. A customer whose own billing runs from
-- the 17th had no way to say so, and had to reconcile a gateway period that
-- did not line up with the invoice it was meant to cover.
--
-- NULL, the default and the value every existing row gets, means exactly what
-- happened before: calendar aligned, no behavior change. Set, the window rolls
-- from this instant instead, Stripe billing_cycle_anchor style.
--
-- Nullable rather than defaulted to the creation time: NULL is the only value
-- that can mean "calendar", and backfilling creation times would silently
-- re-phase every budget in the fleet onto the day it happened to be made.

ALTER TABLE "GatewayBudget" ADD COLUMN "cycleAnchorAt" TIMESTAMP(3);
