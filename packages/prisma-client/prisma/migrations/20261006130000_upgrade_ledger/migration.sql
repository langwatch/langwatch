-- The upgrade ledger: runner-owned tables beside _prisma_migrations. packages/upgrade creates
-- them with this same DDL before any step, so an upgrade from an older release can record its
-- first steps; IF NOT EXISTS lets both creators converge without drift.

-- CreateTable
CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_run" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "release" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "outcome" TEXT,
    "plan" JSONB,
    "report" JSONB,

    CONSTRAINT "_langwatch_upgrade_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_step" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "release" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "report" JSONB,
    "run_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_step_pkey" PRIMARY KEY ("id")
);
