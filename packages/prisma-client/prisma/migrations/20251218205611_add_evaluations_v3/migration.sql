/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "ExperimentType" ADD VALUE 'EVALUATIONS_V3';
