import { createTRPCRouter } from "~/server/api/trpc";
import { organizationRouter } from "./routers/organization";
import { projectRouter } from "./routers/project";
import { teamRouter } from "./routers/team";
import { tracesRouter } from "./routers/traces";
import { spansRouter } from "./routers/spans";
import { analyticsRouter } from "./routers/analytics";
import { checksRouter } from "./routers/checks";
import { costsRouter } from "./routers/costs";
import { planRouter } from "./routers/plan";
import { topicsRouter } from "./routers/topics";
import { datasetRouter } from "./routers/dataset";
import { datasetRecordRouter } from "./routers/datasetRecord";
import { graphsRouter } from "./routers/graphs";
import { evaluationsRouter } from "./routers/evaluations";
import { batchRecordRouter } from "./routers/batchRecord";
import { limitsRouter } from "./routers/limits";
import { dependencies } from "../../injection/dependencies.server";
import { triggerRouter } from "./routers/triggers";
import { experimentsRouter } from "./routers/experiments";
import { annotationRouter } from "./routers/annotation";
import { modelProviderRouter } from "./routers/modelProviders";
import { userRouter } from "./routers/user";
import { annotationScoreRouter } from "./routers/annotationScore";
import { publicEnvRouter } from "./routers/publicEnv";
import { shareRouter } from "./routers/share";
import { llmModelCostsRouter } from "./routers/llmModelCosts";
import { translateRouter } from "./routers/translate";
import { workflowRouter } from "./routers/workflows";
import { optimizationRouter } from "./routers/optimization";
import { integrationsChecksRouter } from "./routers/integrationsChecks";
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
  checks: checksRouter,
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
  ...(dependencies.extraTRPCRoutes?.() ?? {}),
});

// export type definition of API
export type AppRouter = typeof appRouter;
