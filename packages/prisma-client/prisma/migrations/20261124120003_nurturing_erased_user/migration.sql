-- Each account nurturing erased, as a SHA-256 of its id and never the id itself, owned by
-- nurturing. A gateway lifecycle fact folded into "NurturingVirtualKey" stores no creator or
-- holder whose hash is here, so a fact stamped before an erasure that lands after it cannot
-- name the erased account again: not on a key with no holder yet, not on a key copied after
-- the erasure, and not from a late created fact (https://github.com/langwatch/tasks/issues/1204).
-- The hash is of "nurturing-erased-user:" + the id. User ids are nanoids (~126 random bits), so
-- a keyed hash (as governance uses for guessable emails) isn't needed; the prefix stops joins
-- with the bare SHA-256 of an id that nurturing's delivery claim keys carry.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key.
--
-- Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingErasedUser";

CREATE TABLE IF NOT EXISTS "NurturingErasedUser" (
    "userIdHash" TEXT NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurturingErasedUser_pkey" PRIMARY KEY ("userIdHash")
);
