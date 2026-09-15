/*
  Warnings:

  - You are about to drop the column `isGuardrail` on the `Check` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EvaluationExecutionMode" AS ENUM ('ON_MESSAGE', 'AS_GUARDRAIL', 'MANUALLY');

-- AlterTable
ALTER TABLE "Check" ADD COLUMN     "executionMode" "EvaluationExecutionMode" NOT NULL DEFAULT 'ON_MESSAGE';

-- Mark all records with isGuardrail=true as AS_GUARDRAIL
UPDATE "Check" SET "executionMode" = 'AS_GUARDRAIL' WHERE "isGuardrail" = true;

-- Drop the isGuardrail column
ALTER TABLE "Check" DROP COLUMN "isGuardrail";
