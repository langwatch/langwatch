/**
 * `/api/cron` — the deployment's own housekeeping door. A Kubernetes CronJob
 * curls these paths with the shared `CRON_API_KEY` bearer and nothing else may
 * reach them, because a caller reaching `old_lambdas_cleanup` can delete this
 * deployment's Lambda functions.
 *
 * The gate is the DOOR's, not a handler's: every route answers behind
 * `internalSecret`, so the deployment's shared-secret check runs ahead of both
 * of them and a route whose author forgets a check still ships authenticated.
 *
 * It is declared here rather than by the process because the Lambdas it deletes
 * are the studio's per-project NLP engines and the policy deciding which are
 * quiet is this module's own service.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  WorkflowApi,
  workflowCronRestSweepFailedSchema,
  workflowCronRestSweptSchema,
} from "@langwatch/workflow-contract";
import type { z } from "zod";

/** Why the bearer alone is the whole gate on both addresses. */
const CRON_BEARER_IS_THE_GATE = "the deployment's own cron bearer is the whole gate";

/**
 * Both addresses the CronJob already curls, literally. `v1Twin: false`: the
 * family was never aliased under `/api/v1`, and a deployment secret's door is
 * not somewhere to publish a second address nobody asked for.
 *
 * Two methods on one path because the Kubernetes job has always sent whichever
 * its manifest happened to name, and dropping either would silently stop a
 * running cluster's sweep.
 */
export const cronRest = defineRestRouter(WorkflowApi)
  .withNamespace("cron")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/cron/old_lambdas_cleanup", "runOldLambdasCleanup")
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
