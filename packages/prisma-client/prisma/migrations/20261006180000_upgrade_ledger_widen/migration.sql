-- The upgrade ledger, widened: the owner and description a declaring module gives a step, the
-- floor a run applied with, and three runner-owned tables (one row per target of a step, the
-- runner lease, one presence row per serving process). Additive and IF NOT EXISTS throughout;
-- packages/upgrade creates the same DDL before any step, so both creators converge without drift.

-- AlterTable
ALTER TABLE "_langwatch_upgrade_step" ADD COLUMN IF NOT EXISTS "owner" TEXT;
ALTER TABLE "_langwatch_upgrade_step" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- AlterTable
ALTER TABLE "_langwatch_upgrade_run" ADD COLUMN IF NOT EXISTS "floor" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_target" (
    "step_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_target_pkey" PRIMARY KEY ("step_id","target")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_lease" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_lease_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_langwatch_upgrade_presence" (
    "process_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "release" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_upgrade_presence_pkey" PRIMARY KEY ("process_id")
);
