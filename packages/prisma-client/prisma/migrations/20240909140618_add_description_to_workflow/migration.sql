/*
  Warnings:

  - You are about to drop the column `description` on the `WorkflowVersion` table. All the data in the column will be lost.
  - Added the required column `description` to the `Workflow` table without a default value. This is not possible if the table is not empty.
  - Made the column `icon` on table `Workflow` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `commitMessage` to the `WorkflowVersion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "description" TEXT NOT NULL,
ALTER COLUMN "icon" SET NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowVersion" DROP COLUMN "description",
ADD COLUMN     "commitMessage" TEXT NOT NULL;
