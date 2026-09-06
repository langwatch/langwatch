import { createLogger } from "@langwatch/observability";
import {
  NlpLambdaInvokePort,
  NlpPayloadStagingPort,
  STAGED_PAYLOAD_HEADER,
  type StagedNlpPayload,
} from "../ports/workflow-nlp-lambda.port";

const logger = createLogger("langwatch:workflow:nlp-lambda");

/**
 * Built-in fallback so a deployment that configured no threshold still stages
 * below the 6 MiB (6291456 bytes) AWS synchronous-invoke cap instead of
 * silently inlining oversized bodies.
 */
const INVOKE_STAGING_THRESHOLD_BYTES_DEFAULT = 5 * 1024 * 1024;
const INVOKE_STAGING_PREFIX = "nlpgo-staging";

/**
 * Thrown when an invoke body exceeds the configured maximum. Staging offloads the body to S3,
 * but the receiver re-fetches the whole thing into the Lambda's memory, so an unbounded body
 * would only move the failure from the 6 MiB cap to an engine OOM.
 */
export class InvokePayloadTooLargeError extends Error {
  constructor(options: { bytes: number; limit: number; path: string }) {
    super(
      `nlpgo invoke body for ${options.path} is ${options.bytes} bytes, over the ` +
        `${options.limit}-byte maximum payload cap. Reduce the per-trace ` +
        `input/output size or raise the cap.`,
    );
    this.name = "InvokePayloadTooLargeError";
  }
}

/** The staging policy as a value, so the transport never reads the environment. */
export type NlpInvokeStagingConfig = Readonly<{
  /** Unset falls back to the built-in default rather than disabling staging. */
  stagingThresholdBytes?: number | undefined;
  stagingTtlSeconds: number;
  maxPayloadBytes: number;
}>;

export type NlpInvokeRequest = Readonly<{
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Scopes the staging client and key; without it nothing is ever staged. */
  projectId?: string;
}>;

export type NlpInvokeResponse = Readonly<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/**
 * Sends one request to the NLP engine, whether it answers on a plain URL or
 * behind a per-project Lambda ARN. Only the ARN path stages: a self-hosted
 * engine has no 6 MiB cap, so S3 there costs a round trip for nothing.
 */
export class NlpInvokeTransportAdapter {
  static create(options: {
    /** A plain base URL, or a Lambda function ARN. */
    target: string;
    config: NlpInvokeStagingConfig;
    lambda?: NlpLambdaInvokePort | undefined;
    staging: NlpPayloadStagingPort;
    /** Injected so a test drives the wire without a listener. */
    fetch?: typeof fetch;
  }): NlpInvokeTransportAdapter {
    return new NlpInvokeTransportAdapter(options);
  }

  private constructor(
    private readonly options: {
      target: string;
      config: NlpInvokeStagingConfig;
      lambda?: NlpLambdaInvokePort | undefined;
      staging: NlpPayloadStagingPort;
      fetch?: typeof fetch;
    },
  ) {}

  async send(request: NlpInvokeRequest): Promise<NlpInvokeResponse> {
    if (this.options.target.startsWith("arn:aws:lambda")) {
      return this.invokeLambda(request);
    }

    const call = this.options.fetch ?? fetch;
    const response = await call(`${this.options.target.replace(/\/$/, "")}${request.path}`, {
      method: request.method ?? "GET",
      ...(request.headers ? { headers: request.headers } : {}),
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: () => response.json(),
      text: () => response.text(),
    };
  }

  private async invokeLambda(request: NlpInvokeRequest): Promise<NlpInvokeResponse> {
    const lambda = this.options.lambda;
    if (!lambda) {
      throw new Error(
        "This process was composed without a Lambda transport, so it cannot invoke a per-project NLP engine by ARN.",
      );
    }

    const envelope = {
      rawPath: request.path,
      requestContext: { http: { method: request.method ?? "GET" } },
      headers: request.headers ?? {},
      body: request.body,
    };

    // Checked before staging or invoking. Even staged, a body this large is
    // re-fetched whole into the engine's memory, so it is rejected with an
    // actionable error rather than left to OOM the Lambda.
    if (request.body !== undefined) {
      const bodyBytes = Buffer.byteLength(request.body, "utf-8");
      if (bodyBytes > this.options.config.maxPayloadBytes) {
        throw new InvokePayloadTooLargeError({
          bytes: bodyBytes,
          limit: this.options.config.maxPayloadBytes,
          path: request.path,
        });
      }
    }

    let payload = JSON.stringify(envelope);
    const staged = await this.stageIfOversized({ request, serialized: payload });
    if (staged) {
      payload = JSON.stringify({
        ...envelope,
        body: "",
        headers: { ...envelope.headers, [STAGED_PAYLOAD_HEADER]: staged.url },
      });
    }

    let result;
    try {
      result = await lambda.invoke({ functionArn: this.options.target, payload });
    } finally {
      // By the time the invoke settles the receiver has already fetched the
      // presigned URL. In a finally so a failed invoke still reaps the object;
      // a bucket lifecycle rule covers the crash paths.
      if (staged) await staged.discard();
    }

    // A Lambda response payload can carry NUL-separated frames; the last
    // non-empty one is the body.
    const body = result.payload.split("\u0000").filter(Boolean).pop() ?? "";
    return {
      ok: result.statusCode >= 200 && result.statusCode < 300,
      status: result.statusCode,
      statusText: result.functionError ?? "OK",
      json: () => Promise.resolve(JSON.parse(body) as unknown),
      text: () => Promise.resolve(body),
    };
  }

  /**
   * Decides against the ACTUAL serialized envelope, not the raw body: escaping
   * inflates it, so a body below the threshold can cross it once escaped.
   */
  private async stageIfOversized(input: {
    request: NlpInvokeRequest;
    serialized: string;
  }): Promise<StagedNlpPayload | undefined> {
    const { projectId, body, path } = input.request;
    const staging = this.options.staging;
    if (projectId === undefined || body === undefined) return undefined;

    const threshold =
      this.options.config.stagingThresholdBytes ?? INVOKE_STAGING_THRESHOLD_BYTES_DEFAULT;
    if (Buffer.byteLength(input.serialized, "utf-8") <= threshold) return undefined;

    const staged = await staging.stage({
      projectId,
      keyPrefix: `${INVOKE_STAGING_PREFIX}/${projectId}`,
      serialized: Buffer.from(body, "utf-8"),
      ttlSeconds: this.options.config.stagingTtlSeconds,
    });
    logger.info(
      { projectId, path, thresholdBytes: threshold },
      "staged oversized nlpgo invoke payload via presigned S3 URL",
    );
    return staged;
  }
}
