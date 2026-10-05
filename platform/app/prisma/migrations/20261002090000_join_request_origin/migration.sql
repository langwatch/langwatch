-- ADR-143 v6: where a join request was made.
--
-- `web` for every request that exists today, which is also what a replay of
-- an event written before origins existed folds to, so the projection row
-- and the event log keep saying the same thing. `cli` for a request the
-- welcome screen made on behalf of `langwatch login`'s device-approval page;
-- that request lands a Developer seat whatever the joiner seat says.
ALTER TABLE "JoinRequest"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'web';
