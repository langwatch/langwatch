-- IRREVERSIBLE: adds tables and nullable columns; migrations never drop one, a drop is an operator step.
-- Evaluator versions and deploy labels, owned by the evaluator module. Version 1 of existing evaluators and their
-- creators are filled by the background step evaluator:backfill-versions.
-- Spec: modules/evaluator/specs/evaluator-versioning.feature
CREATE TABLE IF NOT EXISTS "EvaluatorVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "workflowId" TEXT,
    "commitMessage" TEXT,
    "authorId" TEXT,
    "authorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluatorVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EvaluatorVersion_evaluatorId_version_key" ON "EvaluatorVersion"("evaluatorId", "version");
CREATE INDEX IF NOT EXISTS "EvaluatorVersion_projectId_idx" ON "EvaluatorVersion"("projectId");

CREATE TABLE IF NOT EXISTS "EvaluatorVersionLabel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluatorVersionLabel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EvaluatorVersionLabel_evaluatorId_label_key" ON "EvaluatorVersionLabel"("evaluatorId", "label");
CREATE INDEX IF NOT EXISTS "EvaluatorVersionLabel_projectId_idx" ON "EvaluatorVersionLabel"("projectId");
CREATE INDEX IF NOT EXISTS "EvaluatorVersionLabel_versionId_idx" ON "EvaluatorVersionLabel"("versionId");

ALTER TABLE "Evaluator" ADD COLUMN IF NOT EXISTS "createdById" TEXT, ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
