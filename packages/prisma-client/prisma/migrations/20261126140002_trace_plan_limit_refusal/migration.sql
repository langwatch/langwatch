-- CreateTable
CREATE TABLE IF NOT EXISTS "TracePlanLimitRefusal" (
    "projectId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "refusals" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TracePlanLimitRefusal_pkey" PRIMARY KEY ("projectId","day")
);
