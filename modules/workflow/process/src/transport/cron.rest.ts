/** Deployment housekeeping door: shared-secret gate prevents unauthenticated Lambda deletion. */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  WorkflowApi,
  workflowCronRestSweepFailedSchema,
  workflowCronRestSweptSchema,
  workflowCronSweepBodySchema,
} from "@langwatch/workflow-contract";
import type { z } from "zod";

/** Why the bearer alone is the whole gate on both addresses. */
const CRON_BEARER_IS_THE_GATE = "the deployment's own cron bearer is the whole gate";

/** Two methods on one path match the CronJob manifest's actual behavior. */
export const cronRest = defineRestRouter(WorkflowApi)
  .withNamespace("cron")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/cron/old_lambdas_cleanup", "runOldLambdasCleanup")
  .withInput(workflowCronSweepBodySchema)
  .withCredential("internalSecret")
  .withAccess(anyAuthenticated({ reason: CRON_BEARER_IS_THE_GATE }))
  .responds({ 200: workflowCronRestSweptSchema, 500: workflowCronRestSweepFailedSchema })
  .withDocs({ description: "Delete the studio's quiet NLP Lambda functions and their log groups" })
  .handle(({ app }) => sweep(app))

  .get("/api/cron/old_lambdas_cleanup", "readOldLambdasCleanup")
  .withCredential("internalSecret")
  .withAccess(anyAuthenticated({ reason: CRON_BEARER_IS_THE_GATE }))
  .responds({ 200: workflowCronRestSweptSchema, 500: workflowCronRestSweepFailedSchema })
  .withDocs({ description: "The same sweep, for a scheduler that issues it as a GET" })
  .handle(({ app }) => sweep(app))

  .build();

/**
 * The sweep, and the 500 a failed one has always answered. Caught rather than
 * raised: the scheduler reads the body to decide whether to alert, and the
 * process envelope would replace the sentence it reads.
 */
async function sweep(
  app: WorkflowApi,
): Promise<
  | Readonly<{ status: 200; body: z.infer<typeof workflowCronRestSweptSchema> }>
  | Readonly<{ status: 500; body: z.infer<typeof workflowCronRestSweepFailedSchema> }>
> {
  try {
    await app.cleanupOldLambdas();

    return { status: 200, body: { message: "Old lambdas deleted successfully" } };
  } catch (error) {
    return {
      status: 500,
      body: {
        message: "Error deleting old lambdas",
        error: error instanceof Error ? error.message : `${String(error)}`,
      },
    };
  }
}
