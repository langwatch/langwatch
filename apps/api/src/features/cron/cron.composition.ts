/**
 * The destructive cron family's one collaborator: the sweep of the studio's
 * quiet per-project NLP Lambda functions. The policy is the workflow feature's
 * service; this file only names the AWS account it is applied to.
 */
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { AwsNlpLambdaFleetAdapter, NlpLambdaCleanupService } from "@langwatch/workflow-server";
import type { ApiNlpLambdaFleetConfig } from "../../platform/config/api.config";

/**
 * Builds the sweep over the configured account, or nothing where the
 * deployment fronts the engine with no Lambdas at all. The caller decides what
 * an absent sweep means for its route.
 */
export function composeNlpLambdaCleanup(
  fleet: ApiNlpLambdaFleetConfig | undefined,
): NlpLambdaCleanupService | undefined {
  if (!fleet) return undefined;

  const credentials = {
    accessKeyId: fleet.accessKeyId,
    secretAccessKey: fleet.secretAccessKey,
  };
  const logger = createLogger("langwatch:api:cron:nlp-lambda-cleanup");
  return NlpLambdaCleanupService.create({
    fleet: AwsNlpLambdaFleetAdapter.create({
      lambda: new LambdaClient({ region: fleet.region, credentials }),
      logs: new CloudWatchLogsClient({ region: fleet.region, credentials }),
      logger,
    }),
    logger,
  });
}
