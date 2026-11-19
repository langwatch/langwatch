-- Nurturing's own copy of each gateway virtual key, owned by nurturing, folded from gateway's
-- lw.governance.vk_lifecycle facts (ARCHITECTURE §9): the key's organization, name, the person
-- who created it (from the created fact alone), the person it acts for and its purpose (each the
-- latest non-null value by the fact's time), and when it was last disabled, enabled and revoked.
-- Every column folds order-free, so a redelivery or a late fact changes nothing. A budget
-- crossing reads its key's name, holder and state here. A key created before this copy is filled
-- at deploy by nurturing's replay steps from gateway's log; one with no fact left in it has no
-- row, and its crossings send nothing.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key.
--
-- Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingVirtualKey";

CREATE TABLE IF NOT EXISTS "NurturingVirtualKey" (
    "virtualKeyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "keyCreatedAt" TIMESTAMP(3),
    "creatorUserId" TEXT,
    "principalUserId" TEXT,
    "principalUserIdAt" TIMESTAMP(3),
    "purpose" TEXT,
    "purposeAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "NurturingVirtualKey_pkey" PRIMARY KEY ("virtualKeyId")
);

CREATE INDEX IF NOT EXISTS "NurturingVirtualKey_creatorUserId_idx" ON "NurturingVirtualKey" ("creatorUserId");
CREATE INDEX IF NOT EXISTS "NurturingVirtualKey_principalUserId_idx" ON "NurturingVirtualKey" ("principalUserId");
