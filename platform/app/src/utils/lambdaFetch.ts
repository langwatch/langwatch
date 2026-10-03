import {
  InvokeCommand,
  type InvokeCommandOutput,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { type Dispatcher, fetch as undiciFetch } from "undici";
import { env } from "../env.mjs";
import { createLambdaClient } from "../optimization_studio/server/lambda";
import {
  deleteStagedObject,
  STAGED_PAYLOAD_HEADER,
  type StagedObject,
  stagePayloadToS3,
} from "../server/s3/stagePayload";
import { readLWAResponsePayload } from "./lwaPrelude";

const logger = createLogger("langwatch:lambdaFetch");

// Built-in fallback so a deploy with LANGEVALS_STAGING_THRESHOLD_BYTES unset
// still stages below the 6 MiB (6291456 bytes) AWS sync-invoke cap instead of
// silently inlining oversized bodies. Mirrors the studio invoke path
// (optimization_studio/server/lambda/index.ts STUDIO_INVOKE_STAGING_THRESHOLD_BYTES).
const INVOKE_STAGING_THRESHOLD_BYTES_DEFAULT = 5 * 1024 * 1024;
const INVOKE_STAGING_PREFIX = "nlpgo-staging";

/**
 * Status reported to the caller when AWS ran the function but the function
 * itself failed, so nlpgo produced no HTTP response of its own. A gateway
 * status describes it correctly: the hop succeeded, the engine behind it did
 * not answer.
 */
const FUNCTION_ERROR_STATUS = 502;

/**
 * Total attempts for an invoke the Lambda control plane refused BEFORE the
 * function started. Matches the studio client's own allowance
 * (LAMBDA_CLIENT_MAX_ATTEMPTS), which exists to ride out the concurrency burst
 * a cold per-project image causes. Only the errors in
 * {@link invokeNeverStarted} consume these attempts; see
 * {@link sendInvokeAtMostOnce}.
 */
const INVOKE_MAX_ATTEMPTS = 6;

/** First backoff step between refused invokes; doubles per attempt. */
const INVOKE_RETRY_BASE_DELAY_MS = 500;

/** Ceiling on a single backoff step, so six attempts stay inside a turn. */
const INVOKE_RETRY_MAX_DELAY_MS = 8_000;

/**
 * Thrown when an invoke body exceeds EVAL_MAX_PAYLOAD_BYTES. Staging offloads
 * the body to S3, but the nlpgo receiver re-fetches the whole thing into the
 * Lambda's memory, so an unbounded body would just move the failure from the
 * 6 MiB invoke cap to an engine OOM. We fail fast at the cap instead, mirroring
 * the langevals HTTP path (stagedFetch.ts PayloadTooLargeError) — not reused
 * here because that error is coupled to LangevalsCallKind.
 */
export class InvokePayloadTooLargeError extends Error {
  constructor(opts: { bytes: number; limit: number; path: string }) {
    super(
      `nlpgo invoke body for ${opts.path} is ${opts.bytes} bytes, over the ` +
        `${opts.limit}-byte EVAL_MAX_PAYLOAD_BYTES cap. Reduce the per-trace ` +
        `input/output size or raise EVAL_MAX_PAYLOAD_BYTES.`,
    );
    this.name = "InvokePayloadTooLargeError";
  }
}

/**
 * Thrown when a call ran past the `timeoutMs` its caller set, on either lane.
 * Distinct from {@link LambdaFetchAbortedError} because the two mean different
 * things to a caller classifying a failure. A deadline says the engine was
 * still working; a cancellation says the answer is no longer wanted.
 */
export class LambdaFetchTimeoutError extends Error {
  constructor(opts: { path: string; timeoutMs: number }) {
    super(
      `nlpgo call to ${opts.path} exceeded its ${opts.timeoutMs}ms deadline`,
    );
    this.name = "LambdaFetchTimeoutError";
  }
}

/** Thrown when the caller's own `signal` aborted the call, on either lane. */
export class LambdaFetchAbortedError extends Error {
  constructor(opts: { path: string }) {
    super(`nlpgo call to ${opts.path} was cancelled by its caller`);
    this.name = "LambdaFetchAbortedError";
  }
}

type LambdaFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /**
   * Scopes the S3 staging client + key. When set on a Lambda-ARN invoke, an
   * oversized invoke envelope is offloaded to S3 and replaced by an empty body
   * plus the X-Payload-S3-URL header (the receiver fetches the real body from
   * the presigned URL). Required because the AWS InvokeFunction Payload is
   * capped at 6 MiB; without staging, large evaluator/workflow bodies fail with
   * "Request must be smaller than 6291456 bytes for the InvokeFunction operation".
   */
  projectId?: string;
  /**
   * Deadline for the whole call, honoured on BOTH lanes. Past it the call
   * rejects with {@link LambdaFetchTimeoutError}. Omit it and no deadline is
   * imposed, which is what every caller predating this option gets.
   *
   * On the HTTP lane this arms an abort, which does NOT raise undici's own
   * `headersTimeout`/`bodyTimeout` (300s each by default), so a caller whose
   * deadline is longer than that must also pass {@link LambdaFetchInit.dispatcher}.
   */
  timeoutMs?: number;
  /**
   * The caller's own cancellation, honoured on BOTH lanes. Past it the call
   * rejects with {@link LambdaFetchAbortedError}. On the Lambda lane an
   * already-aborted signal is refused before anything is staged or invoked.
   */
  signal?: AbortSignal;
  /**
   * HTTP lane only: an undici `Dispatcher` (see
   * `server/nlpgo/timeouts.ts` `createNlpFetchDispatcher`) for a caller that
   * must hold a socket open longer than undici's 300s `headersTimeout` /
   * `bodyTimeout` defaults, which live on the dispatcher and cannot be raised
   * by an abort signal.
   *
   * Passing it also selects the `fetch` from the same undici package. The two
   * are only usable together: Node's global `fetch` is bound to the undici
   * bundled with the runtime, and this package rejects that request handler
   * up front with "InvalidArgumentError: invalid onRequestStart method".
   * Pairing them here is deliberate, so no caller can mismatch them. See
   * specs/scenarios/nlp-fetch-transport.feature for what that mismatch cost.
   */
  dispatcher?: Dispatcher;
};

type LambdaFetchResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<T>;
  text: () => Promise<string>;
};

/**
 * The reason phrase for a status, so the Lambda lane's `statusText` reads the
 * way the HTTP lane's does. Only the statuses nlpgo and the invoke path
 * actually produce are named; anything else degrades to the number rather than
 * claiming a phrase it does not have.
 */
const REASON_PHRASES: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? `HTTP ${status}`;
}

/**
 * True only for invoke failures that PROVE the function never started, which is
 * the sole condition under which re-invoking cannot re-run the user's code.
 *
 * Throttling is the Lambda control plane refusing the invoke outright, and a
 * connection that was never established means the request never left this
 * process. Everything else (a 5xx from the service, a reset mid-flight, a
 * read timeout) is ambiguous about whether the function got the request, and
 * an ambiguous retry is a second execution of someone's Python.
 */
function invokeNeverStarted(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  if (
    name === "TooManyRequestsException" ||
    name === "ThrottlingException" ||
    name === "EC2ThrottledException"
  ) {
    return true;
  }
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN"
  );
}

function backoffDelayMs(attempt: number): number {
  return Math.min(
    INVOKE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    INVOKE_RETRY_MAX_DELAY_MS,
  );
}

function sleep({
  ms,
  signal,
}: {
  ms: number;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The deadline and cancellation for one call: a single signal to hand the
 * transport, plus the two predicates that say which of them fired, so a
 * failure is classified as a timeout or a cancellation rather than as a
 * generic transport error.
 */
function armDeadline(init: LambdaFetchInit | undefined): {
  signal: AbortSignal | undefined;
  timedOut: () => boolean;
  cancelled: () => boolean;
} {
  const timeoutSignal =
    init?.timeoutMs === undefined
      ? undefined
      : AbortSignal.timeout(init.timeoutMs);
  const signals = [init?.signal, timeoutSignal].filter(
    (candidate): candidate is AbortSignal => candidate !== undefined,
  );
  return {
    signal:
      signals.length === 0
        ? undefined
        : signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals),
    timedOut: () => timeoutSignal?.aborted ?? false,
    cancelled: () => init?.signal?.aborted ?? false,
  };
}

/**
 * Re-raises a transport failure as whichever of the caller's two deadlines
 * actually fired, leaving anything else untouched.
 */
function classifyCallFailure({
  error,
  deadline,
  path,
  timeoutMs,
}: {
  error: unknown;
  deadline: { timedOut: () => boolean; cancelled: () => boolean };
  path: string;
  timeoutMs: number | undefined;
}): never {
  if (deadline.cancelled()) {
    throw new LambdaFetchAbortedError({ path });
  }
  if (deadline.timedOut() && timeoutMs !== undefined) {
    throw new LambdaFetchTimeoutError({ path, timeoutMs });
  }
  throw error;
}

/**
 * Runs one transport call, re-raising a deadline or a cancellation as the
 * typed error for it. A wrapper rather than a bare try/catch so the classified
 * failure can sit on a `return` path and the response stays typed.
 */
async function classifyingCallFailures<R>({
  run,
  deadline,
  path,
  timeoutMs,
}: {
  run: () => Promise<R>;
  deadline: { timedOut: () => boolean; cancelled: () => boolean };
  path: string;
  timeoutMs: number | undefined;
}): Promise<R> {
  try {
    return await run();
  } catch (error) {
    classifyCallFailure({ error, deadline, path, timeoutMs });
  }
}

/**
 * Sends the invoke, retrying ONLY while the error proves the function never
 * started. The AWS client is built with `maxAttempts: 1` so the SDK's own
 * retry policy, which happily re-invokes after a mid-flight failure, cannot
 * re-run the user's code behind this decision.
 */
async function sendInvokeAtMostOnce({
  lambda,
  command,
  signal,
}: {
  lambda: LambdaClient;
  command: InvokeCommand;
  signal: AbortSignal | undefined;
}): Promise<InvokeCommandOutput> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await lambda.send(command, signal ? { abortSignal: signal } : {});
    } catch (error) {
      if (attempt >= INVOKE_MAX_ATTEMPTS || !invokeNeverStarted(error)) {
        throw error;
      }
      logger.warn(
        { attempt, error: (error as { name?: string })?.name },
        "nlpgo invoke refused before the function started, retrying",
      );
      await sleep({ ms: backoffDelayMs(attempt), signal });
    }
  }
}

export const lambdaFetch = async <T>(
  urlOrArn: string,
  path: string,
  init?: LambdaFetchInit,
): Promise<LambdaFetchResponse<T>> => {
  const deadline = armDeadline(init);

  // If it's a Lambda ARN
  if (urlOrArn.startsWith("arn:aws:lambda")) {
    // Refused before anything is staged or invoked: a turn whose caller has
    // already given up must not upload a payload or start user code.
    if (init?.signal?.aborted) {
      throw new LambdaFetchAbortedError({ path });
    }

    // maxAttempts 1: the SDK's own retry policy cannot tell a refused invoke
    // from one that already reached the function, so the decision is made by
    // sendInvokeAtMostOnce instead.
    const lambda = createLambdaClient({ maxAttempts: 1 });

    const payload = {
      rawPath: path,
      requestContext: {
        http: {
          method: init?.method ?? "GET",
        },
      },
      headers: init?.headers ?? {},
      body: init?.body,
    };

    // Offload an oversized invoke envelope to S3. The decision is made against
    // the ACTUAL serialized envelope (post JSON-escaping of the body), not the
    // raw body, because re-stringifying the body into the Payload inflates it —
    // a body can cross the 6 MiB cap only after escaping. The receiver
    // (services/nlpgo/adapters/httpapi/staged_payload.go readStudioRequestBody)
    // fetches the real body from the presigned URL when the header is present.
    const projectId = init?.projectId;

    // Hard cap, checked before staging or invoking. Even with S3 staging a body
    // this large would be re-fetched whole into the engine's memory, so reject
    // it with an actionable error instead of OOMing the Lambda or hitting the
    // opaque AWS "Request must be smaller than 6291456 bytes" message. Mirrors
    // the langevals HTTP path's PayloadTooLargeError fail-fast.
    if (init?.body !== undefined) {
      const bodyBytes = Buffer.byteLength(init.body, "utf-8");
      if (bodyBytes > env.EVAL_MAX_PAYLOAD_BYTES) {
        throw new InvokePayloadTooLargeError({
          bytes: bodyBytes,
          limit: env.EVAL_MAX_PAYLOAD_BYTES,
          path,
        });
      }
    }

    let invokeBody = JSON.stringify(payload);
    let staged: StagedObject | null = null;
    if (projectId !== undefined && init?.body !== undefined) {
      const threshold =
        env.LANGEVALS_STAGING_THRESHOLD_BYTES ??
        INVOKE_STAGING_THRESHOLD_BYTES_DEFAULT;
      if (Buffer.byteLength(invokeBody, "utf-8") > threshold) {
        staged = await stagePayloadToS3({
          projectId,
          keyPrefix: `${INVOKE_STAGING_PREFIX}/${projectId}`,
          serialized: Buffer.from(init.body, "utf-8"),
          ttlSeconds: env.LANGEVALS_STAGING_TTL_SECONDS,
        });
        invokeBody = JSON.stringify({
          ...payload,
          body: "",
          headers: {
            ...payload.headers,
            [STAGED_PAYLOAD_HEADER]: staged.stagedUrl,
          },
        });
        logger.info(
          { projectId, path, thresholdBytes: threshold },
          "staged oversized nlpgo invoke payload via presigned S3 URL",
        );
      }
    }

    const command = new InvokeCommand({
      FunctionName: urlOrArn,
      InvocationType: "RequestResponse",
      Payload: invokeBody,
    });

    let response: InvokeCommandOutput;
    try {
      // The retry loop sits inside this try so a staged object outlives every
      // attempt that may still fetch it, and is reaped exactly once after the
      // last one.
      response = await classifyingCallFailures({
        run: () =>
          sendInvokeAtMostOnce({ lambda, command, signal: deadline.signal }),
        deadline,
        path,
        timeoutMs: init?.timeoutMs,
      });
    } finally {
      // Best-effort delete: by the time lambda.send resolves the receiver has
      // already fetched the presigned URL, so the staged object is no longer
      // needed. Runs in finally so a failed invoke still reaps it; a bucket
      // lifecycle rule on the staging prefix is the orphan/crash fallback.
      if (staged) {
        await deleteStagedObject({
          s3Client: staged.s3Client,
          s3Bucket: staged.s3Bucket,
          key: staged.key,
          projectId: projectId!,
        });
      }
    }

    const { status: engineStatus, body } = readLWAResponsePayload(
      response.Payload,
    );
    const invocationStatus = response.StatusCode ?? 200;
    const functionError = response.FunctionError;

    // Precedence, and why. A FunctionError means AWS ran the handler and the
    // handler raised, so there is no nlpgo response to read a status from and
    // the engine is simply down for this call. A non-2xx invocation status
    // means AWS refused the invoke, likewise with no engine response. Only
    // when the invocation itself succeeded does the prelude's status, which is
    // nlpgo's own, describe the answer; the invocation status is the fallback for
    // a payload that carries no prelude.
    const status = functionError
      ? FUNCTION_ERROR_STATUS
      : invocationStatus >= 200 && invocationStatus < 300
        ? (engineStatus ?? invocationStatus)
        : invocationStatus;

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: functionError ?? reasonPhrase(status),
      json: async () => {
        return JSON.parse(body);
      },
      text: async () => body,
    };
  }

  // If it's a regular URL
  const requestInit = {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    signal: deadline.signal,
  };
  const response = await classifyingCallFailures({
    // undici's own fetch for a dispatcher-carrying call, the global one
    // otherwise. The two fetches and their dispatchers are not
    // interchangeable, see LambdaFetchInit.dispatcher.
    run: (): Promise<Response> =>
      init?.dispatcher
        ? (undiciFetch(urlOrArn + path, {
            ...requestInit,
            dispatcher: init.dispatcher,
          }) as unknown as Promise<Response>)
        : fetch(urlOrArn + path, requestInit),
    deadline,
    path,
    timeoutMs: init?.timeoutMs,
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<T>,
    text: () => response.text(),
  };
};
