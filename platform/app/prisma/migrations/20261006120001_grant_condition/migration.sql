-- ADR-144 / ADR-166: what a SHARED grant lets its principal reach.
--
-- Null on every grant that exists today: an own grant (a member's role on
-- a team or project) reaches the whole scope and needs no condition. A
-- shared project-reader grant - one project reading another - carries
-- { type: "trace" | "span" | "log", where?: OTTL, from?: ISO, until?: ISO }
-- so the proof minted from it can say which rows of the member project the
-- reader may see. v1 writes type "trace" with a from date and no where.
--
-- Down, to roll back by hand:
--   ALTER TABLE "Grant" DROP COLUMN "condition";
-- Rolling back forgets the window on every shared grant; the shape
-- refinement refuses a project-reader grant without one, so the next
-- reconcile re-emits them rather than reading unbounded.
ALTER TABLE "Grant"
  ADD COLUMN "condition" JSONB;
