import type { RedisConnection } from "@langwatch/redis-client";
import {
  NlpLambdaErrorReportingPort,
  NlpLambdaPayloadStagingPort,
  NlpLambdaRuntime,
  NlpLambdaStagedPayload,
  type NlpLambdaPayloadStageRequest,
  type NlpLambdaRuntimeConfig,
} from "~/runtime/api/nlp-lambda";
import { type AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import { deleteStagedObject, stagePayloadToS3, type StagedObject } from "~/server/s3/stagePayload";
import { captureException } from "~/utils/posthogErrorCapture";
import { AppNlpLambdaAwsClientAdapter } from "./nlp-lambda.aws-client.adapter";

class AppNlpLambdaStagedPayload extends NlpLambdaStagedPayload {
  constructor(
    private readonly staged: StagedObject,
    private readonly projectId: string,
  ) {
    super();
  }

  get url(): string {
    return this.staged.stagedUrl;
  }

  async delete(): Promise<void> {
    await deleteStagedObject({ ...this.staged, projectId: this.projectId });
  }
}

class AppNlpLambdaPayloadStagingPort extends NlpLambdaPayloadStagingPort {
  async stage(input: NlpLambdaPayloadStageRequest): Promise<NlpLambdaStagedPayload> {
    const staged = await stagePayloadToS3(input);
    return new AppNlpLambdaStagedPayload(staged, input.projectId);
  }
}

class AppNlpLambdaErrorReportingPort extends NlpLambdaErrorReportingPort {
  capture(input: { error: Error; extra: Record<string, unknown> }): void {
    captureException(input.error, { extra: input.extra });
  }
}

export function createProcessNlpLambdaRuntime(input: {
  config: NlpLambdaRuntimeConfig;
  redis: RedisConnection | null;
  aws?: AppAwsClientConfiguration;
}): NlpLambdaRuntime {
  const awsClients =
    input.config.deployment === undefined
      ? undefined
      : AppNlpLambdaAwsClientAdapter.create({
          aws: input.aws ?? missingAwsConfiguration(),
          deployment: input.config.deployment,
        });

  return NlpLambdaRuntime.create({
    config: input.config,
    redis: input.redis,
    awsClients,
    payloadStaging: new AppNlpLambdaPayloadStagingPort(),
    errorReporting: new AppNlpLambdaErrorReportingPort(),
  });
}

function missingAwsConfiguration(): never {
  throw new Error("NLP Lambda deployment requires a composed AWS configuration.");
}
