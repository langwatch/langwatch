import type { RedisConnection } from "@langwatch/redis-client";
import {
  NlpLambdaErrorReportingPort,
  NlpLambdaPayloadStagingPort,
  NlpLambdaRuntime,
  NlpLambdaStagedPayload,
  type NlpLambdaPayloadStageRequest,
  type NlpLambdaRuntimeConfig,
} from "~/runtime/api/nlp-lambda";
import {
  deleteStagedObject,
  stagePayloadToS3,
  type StagedObject,
} from "~/server/s3/stagePayload";
import { captureException } from "~/utils/posthogErrorCapture";

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
}): NlpLambdaRuntime {
  return NlpLambdaRuntime.create({
    config: input.config,
    redis: input.redis,
    payloadStaging: new AppNlpLambdaPayloadStagingPort(),
    errorReporting: new AppNlpLambdaErrorReportingPort(),
  });
}
