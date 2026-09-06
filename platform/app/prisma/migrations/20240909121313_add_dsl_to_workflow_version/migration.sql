/*
  Warnings:

  - Added the required column `dsl` to the `WorkflowVersion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WorkflowVersion" ADD COLUMN     "dsl" JSONB NOT NULL;
