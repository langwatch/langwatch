/*
  Warnings:

  - A unique constraint covering the columns `[workflowId,version]` on the table `WorkflowVersion` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `version` to the `WorkflowVersion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WorkflowVersion" ADD COLUMN     "version" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
