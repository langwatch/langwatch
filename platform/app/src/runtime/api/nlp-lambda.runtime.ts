import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  InvokeCommand,
  InvokeWithResponseStreamCommand,
  type InvokeWithResponseStreamCommandOutput,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { NlpLambdaAwsAdapter, type NlpLambdaArnCache } from "./nlp-lambda.aws.adapter";
import { createStudioNlpCacheKey } from "./nlp-lambda.cache-key";
import type { NlpLambdaRuntimeConfig } from "./nlp-lambda.config";
import {
  NoopNlpLambdaErrorReportingPort,
  NoopNlpLambdaPayloadStagingPort,
  type NlpLambdaAwsClientPort,
  type NlpLambdaErrorReportingPort,
  type NlpLambdaPayloadStagingPort,
  type NlpLambdaStagedPayload,
} from "./nlp-lambda.ports";

const logger = createLogger("langwatch:nlp-lambda-runtime");
const defaultStagingThresholdBytes = 5 * 1024 * 1024;

function missingNlpLambdaAwsClients(): never {
  throw new Error("NLP Lambda infrastructure requires process-owned AWS clients.");
}

export type NlpLambdaInvocationLimits = {
  maxPayloadBytes: number;
  stagingThresholdBytes: number;
  stagingTtlSeconds: number;
};

export type NlpLambdaFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  projectId?: string;
};

export type NlpLambdaFetchResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<T>;
  text: () => Promise<string>;
};

export abstract class NlpLambdaResponseStream {
  declare protected readonly nlpLambdaResponseStreamBrand: "NlpLambdaResponseStream";

  abstract readonly eventStream: NonNullable<InvokeWithResponseStreamCommandOutput["EventStream"]>;

  abstract release(): Promise<void>;
}

export class NlpLambdaPayloadTooLargeError extends Error {
  constructor(input: { bytes: number; limit: number; path: string }) {
    super(
      `nlpgo invoke body for ${input.path} is ${input.bytes} bytes, over the ` +
        `${input.limit}-byte EVAL_MAX_PAYLOAD_BYTES cap. Reduce the per-trace ` +
        `input/output size or raise EVAL_MAX_PAYLOAD_BYTES.`,
    );
    this.name = "InvokePayloadTooLargeError";
  }
}

class PreparedInvocation {
  private released = false;

  constructor(
    readonly body: string,
    private readonly staged: NlpLambdaStagedPayload | undefined,
  ) {}

  async release(): Promise<void> {
    if (this.released || this.staged === undefined) {
      return;
    }
    this.released = true;
    await this.staged.delete();
  }
}

class ManagedNlpLambdaResponseStream extends NlpLambdaResponseStream {
  constructor(
    readonly eventStream: NonNullable<InvokeWithResponseStreamCommandOutput["EventStream"]>,
    private readonly prepared: PreparedInvocation,
  ) {
    super();
  }

  async release(): Promise<void> {
    await this.prepared.release();
  }
}

export class NlpLambdaRuntime {
  private readonly lambda: NlpLambdaAwsAdapter | undefined;

  private constructor(
    private readonly config: NlpLambdaRuntimeConfig,
    redis: NlpLambdaArnCache | null,
    awsClients: NlpLambdaAwsClientPort | undefined,
    private readonly payloadStaging: NlpLambdaPayloadStagingPort,
    private readonly errorReporting: NlpLambdaErrorReportingPort,
  ) {
    if (config.deployment !== undefined) {
      this.lambda = NlpLambdaAwsAdapter.create({
        deployment: config.deployment,
        baseHost: config.baseHost,
        redis,
        clients: awsClients ?? missingNlpLambdaAwsClients(),
      });
    }
  }

  static create(input: {
    config: NlpLambdaRuntimeConfig;
    redis: NlpLambdaArnCache | null;
    awsClients?: NlpLambdaAwsClientPort;
    payloadStaging?: NlpLambdaPayloadStagingPort;
    errorReporting?: NlpLambdaErrorReportingPort;
  }): NlpLambdaRuntime {
    return new NlpLambdaRuntime(
      input.config,
      input.redis,
      input.awsClients,
      input.payloadStaging ?? new NoopNlpLambdaPayloadStagingPort(),
      input.errorReporting ?? new NoopNlpLambdaErrorReportingPort(),
    );
  }

  usesLambda(): boolean {
    return this.lambda !== undefined && this.config.deployment !== undefined;
  }

  close(): Promise<void> {
    return this.lambda?.close() ?? Promise.resolve();
  }

  async resolveTarget(projectId: string): Promise<string> {
    if (this.lambda !== undefined && this.config.deployment !== undefined) {
      return this.lambda.getProjectLambdaArn(projectId);
    }

    return this.config.serviceUrl ?? "";
  }

  createLambdaClient(): LambdaClient {
    if (this.lambda === undefined || this.config.deployment === undefined) {
      throw new Error("NLP Lambda infrastructure is not configured.");
    }
    return this.lambda.createLambdaClient();
  }

  createLogsClient(): CloudWatchLogsClient {
    if (this.lambda === undefined || this.config.deployment === undefined) {
      throw new Error("NLP Lambda infrastructure is not configured.");
    }
    return this.lambda.createLogsClient();
  }

  getInvocationLimits(): NlpLambdaInvocationLimits {
    return {
      maxPayloadBytes: this.config.maxPayloadBytes,
      stagingThresholdBytes: this.config.staging.thresholdBytes ?? defaultStagingThresholdBytes,
      stagingTtlSeconds: this.config.staging.ttlSeconds,
    };
  }

  getStudioCacheKey(projectId: string): string | undefined {
    return createStudioNlpCacheKey({
      projectId,
      salt: this.config.studioCacheKeySalt,
      now: new Date(),
    });
  }

  reportException(error: Error, extra: Record<string, unknown>): void {
    this.errorReporting.capture({ error, extra });
  }

  async invoke<T>(
    target: string,
    path: string,
    init: NlpLambdaFetchInit = {},
  ): Promise<NlpLambdaFetchResponse<T>> {
    if (!target.startsWith("arn:aws:lambda")) {
      const response = await fetch(target + path, init);
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        json: async () => await response.json(),
        text: () => response.text(),
      };
    }

    const prepared = await this.prepareInvocation({
      projectId: init.projectId,
      path,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
      supportsStaging: init.projectId !== undefined && init.body !== undefined,
      enforceMaximumPayload: true,
      stagingPrefix: "nlpgo-staging",
    });

    try {
      const response = await this.createLambdaClient().send(
        new InvokeCommand({
          FunctionName: target,
          InvocationType: "RequestResponse",
          Payload: prepared.body,
        }),
      );
      const responsePayload = response.Payload
        ? Buffer.from(response.Payload).toString("utf-8")
        : "";
      const actualBody = responsePayload.split("\u0000").filter(Boolean).pop() ?? "";
      const statusCode = response.StatusCode ?? 200;

      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        statusText: response.FunctionError ?? "OK",
        json: async () => JSON.parse(actualBody),
        text: async () => actualBody,
      };
    } finally {
      await prepared.release();
    }
  }

  async invokeResponseStream(input: {
    projectId: string;
    path: string;
    headers: Record<string, string>;
    body: string;
    supportsStaging: boolean;
  }): Promise<NlpLambdaResponseStream> {
    if (!this.usesLambda()) {
      throw new Error("NLP Lambda infrastructure is not configured.");
    }

    const prepared = await this.prepareInvocation({
      projectId: input.projectId,
      path: input.path,
      method: "POST",
      headers: input.headers,
      body: input.body,
      supportsStaging: input.supportsStaging,
      enforceMaximumPayload: false,
      stagingPrefix: "studio-staging",
    });

    try {
      const response = await this.createLambdaClient().send(
        new InvokeWithResponseStreamCommand({
          FunctionName: await this.resolveTarget(input.projectId),
          InvocationType: "RequestResponse",
          Payload: prepared.body,
        }),
      );
      if (response.EventStream === undefined) {
        await prepared.release();
        throw new Error("No payload received from Lambda");
      }

      return new ManagedNlpLambdaResponseStream(response.EventStream, prepared);
    } catch (error) {
      await prepared.release();
      throw error;
    }
  }

  private async prepareInvocation(input: {
    projectId: string | undefined;
    path: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    supportsStaging: boolean;
    enforceMaximumPayload: boolean;
    stagingPrefix: string;
  }): Promise<PreparedInvocation> {
    const bodyBytes = input.body === undefined ? 0 : Buffer.byteLength(input.body, "utf-8");
    if (input.enforceMaximumPayload && bodyBytes > this.config.maxPayloadBytes) {
      throw new NlpLambdaPayloadTooLargeError({
        bytes: bodyBytes,
        limit: this.config.maxPayloadBytes,
        path: input.path,
      });
    }

    const payload = {
      rawPath: input.path,
      requestContext: { http: { method: input.method } },
      headers: input.headers,
      body: input.body,
    };
    let body = JSON.stringify(payload);
    let staged: NlpLambdaStagedPayload | undefined;
    const limits = this.getInvocationLimits();

    if (
      input.supportsStaging &&
      input.projectId !== undefined &&
      input.body !== undefined &&
      Buffer.byteLength(body, "utf-8") > limits.stagingThresholdBytes
    ) {
      staged = await this.payloadStaging.stage({
        projectId: input.projectId,
        keyPrefix: `${input.stagingPrefix}/${input.projectId}`,
        serialized: Buffer.from(input.body, "utf-8"),
        ttlSeconds: limits.stagingTtlSeconds,
      });
      body = JSON.stringify({
        ...payload,
        body: "",
        headers: {
          ...payload.headers,
          "X-Payload-S3-URL": staged.url,
        },
      });
      logger.info(
        {
          projectId: input.projectId,
          path: input.path,
          thresholdBytes: limits.stagingThresholdBytes,
        },
        "staged oversized NLP Lambda invoke payload",
      );
    }

    return new PreparedInvocation(body, staged);
  }
}
