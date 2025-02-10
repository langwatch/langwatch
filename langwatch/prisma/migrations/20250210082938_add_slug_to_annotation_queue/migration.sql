/*
  Warnings:

  - Added the required column `slug` to the `AnnotationQueue` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AnnotationQueue" ADD COLUMN     "slug" TEXT NOT NULL;
