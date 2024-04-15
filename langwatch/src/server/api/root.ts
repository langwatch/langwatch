import { createTRPCRouter } from "~/server/api/trpc";
import { organizationRouter } from "./routers/organization";
import { projectRouter } from "./routers/project";
import { teamRouter } from "./routers/team";
import { tracesRouter } from "./routers/traces";
import { spansRouter } from "./routers/spans";
import { analyticsRouter } from "./routers/analytics";
import { checksRouter } from "./routers/checks";
import { costsRouter } from "./routers/costs";
import { subscriptionRouter } from "./routers/subscription";
import { topicsRouter } from "./routers/topics";
import { datasetRouter } from "./routers/dataset";
import { datasetRecordRouter } from "./routers/datasetRecord";
import { graphsRouter } from "./routers/graphs";
import { evaluationsRouter } from "./routers/evaluations";
import { limitsRouter } from "./routers/limits";

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
  subscription: subscriptionRouter,
  topics: topicsRouter,
  dataset: datasetRouter,
  datasetRecord: datasetRecordRouter,
  graphs: graphsRouter,
  evaluations: evaluationsRouter,
  limits: limitsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
