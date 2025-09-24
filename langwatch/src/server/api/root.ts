import { createTRPCRouter } from "~/server/api/trpc";

import { dependencies } from "../../injection/dependencies.server";

import { analyticsRouter } from "./routers/analytics";
import { annotationRouter } from "./routers/annotation";
import { annotationScoreRouter } from "./routers/annotationScore";
import { batchRecordRouter } from "./routers/batchRecord";
import { costsRouter } from "./routers/costs";
import { datasetRouter } from "./routers/dataset";
import { datasetRecordRouter } from "./routers/datasetRecord";
import { evaluationsRouter } from "./routers/evaluations";
import { experimentsRouter } from "./routers/experiments";
import { graphsRouter } from "./routers/graphs";
import { integrationsChecksRouter } from "./routers/integrationsChecks";
import { limitsRouter } from "./routers/limits";
import { llmModelCostsRouter } from "./routers/llmModelCosts";
import { modelProviderRouter } from "./routers/modelProviders";
import { monitorsRouter } from "./routers/monitors";
import { onboardingRouter } from "./routers/onboarding";
import { optimizationRouter } from "./routers/optimization";
import { organizationRouter } from "./routers/organization";
import { planRouter } from "./routers/plan";
import { projectRouter } from "./routers/project";
import { spansRouter } from "./routers/spans";
import { teamRouter } from "./routers/team";
import { tracesRouter } from "./routers/traces";
import { topicsRouter } from "./routers/topics";
import { translateRouter } from "./routers/translate";
import { triggerRouter } from "./routers/triggers";
import { userRouter } from "./routers/user";
import { publicEnvRouter } from "./routers/publicEnv";
import { shareRouter } from "./routers/share";
import { workflowRouter } from "./routers/workflows";
import { llmConfigsRouter } from "./routers/prompts/llm-prompt-configs/llmConfigs";
import { scenarioRouter } from "./routers/scenario";
/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  organization: organizationRouter,
  project: projectRouter,
  team: teamRouter,
  traces: tracesRouter,
  spans: spansRouter,
  analytics: analyticsRouter,
  monitors: monitorsRouter,
  costs: costsRouter,
  plan: planRouter,
  topics: topicsRouter,
  dataset: datasetRouter,
  datasetRecord: datasetRecordRouter,
  graphs: graphsRouter,
  evaluations: evaluationsRouter,
  batchRecord: batchRecordRouter,
  limits: limitsRouter,
  trigger: triggerRouter,
  experiments: experimentsRouter,
  annotation: annotationRouter,
  modelProvider: modelProviderRouter,
  llmModelCost: llmModelCostsRouter,
  user: userRouter,
  annotationScore: annotationScoreRouter,
  publicEnv: publicEnvRouter,
  share: shareRouter,
  translate: translateRouter,
  workflow: workflowRouter,
  optimization: optimizationRouter,
  integrationsChecks: integrationsChecksRouter,
  onboarding: onboardingRouter,
  llmConfigs: llmConfigsRouter,
  scenarios: scenarioRouter,
  ...(dependencies.extraTRPCRoutes?.() ?? {}),
});

// export type definition of API
export type AppRouter = typeof appRouter;
