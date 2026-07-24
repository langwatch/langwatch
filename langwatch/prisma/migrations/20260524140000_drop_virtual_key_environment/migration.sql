-- Drop VirtualKey.environment column + VirtualKeyEnvironment enum.
--
-- Rationale: the live/test split was a Stripe-pattern half-ship. The form
-- exposed a select widget, the schema stored the value, but no behavior was
-- ever wired off it: prefix is universally "vk-lw-" (no live/test suffix),
-- the Go gateway data plane never reads vk.environment for routing/dispatch
-- /auth, and the only consumers were a chip color (green for live, gray for
-- test) on the list + detail pages. Zero retro-compat per the refactor
-- directive.
--
-- Forward-only. No data migration: the column is being removed; existing
-- values (LIVE on every row by default) carry no information that needs
-- preservation.

ALTER TABLE "VirtualKey" DROP COLUMN "environment";

DROP TYPE "VirtualKeyEnvironment";
