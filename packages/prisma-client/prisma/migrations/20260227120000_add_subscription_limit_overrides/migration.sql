-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "maxMembersLite" INTEGER,
ADD COLUMN     "maxTeams" INTEGER,
ADD COLUMN     "maxPrompts" INTEGER,
ADD COLUMN     "maxEvaluators" INTEGER,
ADD COLUMN     "maxScenarios" INTEGER,
ADD COLUMN     "maxAgents" INTEGER,
ADD COLUMN     "maxExperiments" INTEGER,
ADD COLUMN     "maxOnlineEvaluations" INTEGER,
ADD COLUMN     "maxDatasets" INTEGER,
ADD COLUMN     "maxDashboards" INTEGER,
ADD COLUMN     "maxCustomGraphs" INTEGER,
ADD COLUMN     "maxAutomations" INTEGER;
