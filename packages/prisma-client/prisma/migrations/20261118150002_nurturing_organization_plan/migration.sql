-- Nurturing's own copy of each organization's plan, owned by nurturing, folded from billing's
-- lw.billing.subscription_changed facts (ARCHITECTURE §9). The newest billing fact wins, and a
-- real fact wins a tie over a catch-up (ADR-174 decision 17). Customer.io hears a fact only when
-- it changes this row, so a stale or losing fact sends nothing. An organization with no fact
-- since this copy has no row.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key.
--
-- Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingOrganizationPlan";

CREATE TABLE IF NOT EXISTS "NurturingOrganizationPlan" (
    "organizationId" TEXT NOT NULL,
    "plan" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "fromCatchUp" BOOLEAN NOT NULL,

    CONSTRAINT "NurturingOrganizationPlan_pkey" PRIMARY KEY ("organizationId")
);
