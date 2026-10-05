import { STATUS_CODES } from "node:http";

import { createLogger } from "@langwatch/observability";

import { readLwaResponsePayload } from "../rules/lambda-web-adapter-stream.rules.ts";
import { sealStagedPayload } from "../rules/staged-payload-seal.rules.ts";
import {
  type NlpLambdaInvoke,
  type NlpLambdaInvokeResult,
  type NlpPayloadStaging,
  STAGED_PAYLOAD_HEADER,
  STAGED_PAYLOAD_KEY_HEADER,
  type StagedNlpPayload,
} from "./nlp-lambda.channel.ts";

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

/** AWS ran the function and it raised, so the engine gave no answer: a gateway status. */
const FUNCTION_ERROR_STATUS = 502;

/** The call ran past the `timeoutMs` its caller set, on either lane: the engine was still busy. */
export class NlpInvokeTimeoutError extends Error {
  constructor(options: { path: string; timeoutMs: number }) {
    super(`nlpgo call to ${options.path} exceeded its ${options.timeoutMs}ms deadline`);
    this.name = "NlpInvokeTimeoutError";
  }
}

/** The caller's own `signal` aborted the call, on either lane: the answer is no longer wanted. */
export class NlpInvokeAbortedError extends Error {
  constructor(options: { path: string }) {
    super(`nlpgo call to ${options.path} was cancelled by its caller`);
    this.name = "NlpInvokeAbortedError";
  }
}

type Deadline = Readonly<{
  signal: AbortSignal | undefined;
  hasTimedOut: () => boolean;
  isCancelled: () => boolean;
}>;

/** One signal for the transport, and which of the caller's two limits fired. */
function armDeadline(request: NlpInvokeRequest): Deadline {
  const timeoutSignal =
    request.timeoutMs === undefined ? undefined : AbortSignal.timeout(request.timeoutMs);
  const signals = [request.signal, timeoutSignal].filter(
    (candidate): candidate is AbortSignal => candidate !== undefined,
  );
  return {
    signal: signals.length <= 1 ? signals[0] : AbortSignal.any(signals),
    hasTimedOut: () => timeoutSignal?.aborted ?? false,
    isCancelled: () => request.signal?.aborted ?? false,
  };
}

/** Runs one transport call, re-raising a fired deadline or cancellation as its typed error. */
async function classifyingLimits<R>(input: {
  run: () => Promise<R>;
  deadline: Deadline;
  request: NlpInvokeRequest;
}): Promise<R> {
  const { deadline, request } = input;
  try {
    return await input.run();
  } catch (error) {
    if (deadline.isCancelled()) throw new NlpInvokeAbortedError({ path: request.path });
    if (deadline.hasTimedOut() && request.timeoutMs !== undefined) {
      throw new NlpInvokeTimeoutError({ path: request.path, timeoutMs: request.timeoutMs });
    }
    throw error;
  }
}

/** A FunctionError is a 502; a refused invoke keeps AWS's status; else the engine's own. */
function answeredStatus(input: {
  result: NlpLambdaInvokeResult;
  engineStatus: number | null;
}): number {
  const { result, engineStatus } = input;
  if (result.functionError) return FUNCTION_ERROR_STATUS;
  const invocationSucceeded = result.statusCode >= 200 && result.statusCode < 300;
  if (!invocationSucceeded) return result.statusCode;
  return engineStatus ?? result.statusCode;
}

/** The reason phrase `fetch` would give, so both lanes describe one engine answer alike. */
function reasonPhrase(status: number): string {
  return STATUS_CODES[status] ?? `HTTP ${status}`;
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
  /** A deadline for the whole call on either lane; absent imposes none. */
  timeoutMs?: number;
  /** The caller's cancellation on either lane; already aborted, nothing is staged or sent. */
  signal?: AbortSignal;
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
    lambda?: NlpLambdaInvoke | undefined;
    staging?: NlpPayloadStaging | undefined;
    /** Injected so a test drives the wire without a listener. */
    fetch?: typeof fetch;
  }): NlpInvokeTransportAdapter {
    return new NlpInvokeTransportAdapter(options);
  }

  private constructor(
    private readonly options: {
      target: string;
      config: NlpInvokeStagingConfig;
      lambda?: NlpLambdaInvoke | undefined;
      staging?: NlpPayloadStaging | undefined;
      fetch?: typeof fetch;
    },
  ) {}

  async send(request: NlpInvokeRequest): Promise<NlpInvokeResponse> {
    const deadline = armDeadline(request);
    const targetIsLambdaArn = this.options.target.startsWith("arn:aws:lambda");
    if (targetIsLambdaArn) {
      return this.invokeLambda({ request, deadline });
    }

    const call = this.options.fetch ?? fetch;
    const response = await classifyingLimits({
      run: () =>
        call(`${this.options.target.replace(/\/$/, "")}${request.path}`, {
          method: request.method ?? "GET",
          ...(request.headers ? { headers: request.headers } : {}),
          ...(request.body === undefined ? {} : { body: request.body }),
          ...(deadline.signal ? { signal: deadline.signal } : {}),
        }),
      deadline,
      request,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: () => response.json(),
      text: () => response.text(),
    };
  }

  private async invokeLambda({
    request,
    deadline,
  }: {
    request: NlpInvokeRequest;
    deadline: Deadline;
  }): Promise<NlpInvokeResponse> {
    // A turn whose caller already gave up must not upload a payload or start user code.
    if (request.signal?.aborted) throw new NlpInvokeAbortedError({ path: request.path });

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
      const maxPayloadBytes = this.options.config.maxPayloadBytes;
      const bodyExceedsMaxPayload = bodyBytes > maxPayloadBytes;
      if (bodyExceedsMaxPayload) {
        throw new InvokePayloadTooLargeError({
          bytes: bodyBytes,
          limit: maxPayloadBytes,
          path: request.path,
        });
      }
    }

    let payload = JSON.stringify(envelope);
    const parked = await this.stageIfOversized({ request, serialized: payload });
    const staged = parked?.payload;
    if (parked) {
      payload = JSON.stringify({
        ...envelope,
        body: "",
        headers: {
          ...envelope.headers,
          [STAGED_PAYLOAD_HEADER]: parked.payload.url,
          [STAGED_PAYLOAD_KEY_HEADER]: parked.key,
        },
      });
    }

    let result;
    try {
      // The channel's retries sit inside this try, so a staged object outlives every attempt.
      result = await classifyingLimits({
        run: () =>
          lambda.invoke({ functionArn: this.options.target, payload, signal: deadline.signal }),
        deadline,
        request,
      });
    } finally {
      // By the time the invoke settles the receiver has already fetched the
      // presigned URL. In a finally so a failed invoke still reaps the object;
      // a bucket lifecycle rule covers the crash paths.
      if (staged) await staged.discard();
    }

    // A FunctionError or a refused invoke carries no engine answer; only a successful
    // invocation's prelude states nlpgo's own status, and a payload without one keeps AWS's.
    const { status: engineStatus, body } = readLwaResponsePayload(
      Buffer.from(result.payload, "utf-8"),
    );
    const status = answeredStatus({ result, engineStatus });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: result.functionError ?? reasonPhrase(status),
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
  }): Promise<{ payload: StagedNlpPayload; key: string } | undefined> {
    const { projectId, body, path } = input.request;
    if (projectId === undefined || body === undefined) return undefined;

    const threshold =
      this.options.config.stagingThresholdBytes ?? INVOKE_STAGING_THRESHOLD_BYTES_DEFAULT;
    const bytes = Buffer.byteLength(input.serialized, "utf-8");
    if (bytes <= threshold) return undefined;

    const staging = this.options.staging;
    if (!staging) {
      throw new Error(
        `The nlpgo invoke for ${path} is ${bytes} bytes, over the ${threshold}-byte ` +
          "direct invoke limit, and this deployment composed no object storage to park it in.",
      );
    }

    const { sealed, key } = sealStagedPayload(Buffer.from(body, "utf-8"));
    const payload = await staging.stage({
      projectId,
      keyPrefix: `${INVOKE_STAGING_PREFIX}/${projectId}`,
      serialized: sealed,
      ttlSeconds: this.options.config.stagingTtlSeconds,
    });
    logger.info(
      { projectId, path, thresholdBytes: threshold },
      "staged oversized nlpgo invoke payload via presigned S3 URL",
    );
    return { payload, key };
  }
}
