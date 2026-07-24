-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "redTeamConfig" JSONB,
ADD COLUMN     "redTeamStrategy" TEXT,
ADD COLUMN     "redTeamTarget" TEXT,
ADD COLUMN     "redTeamTotalTurns" INTEGER;
