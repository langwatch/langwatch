import { InvokeCommand } from "@aws-sdk/client-lambda";
import { createLogger } from "@langwatch/observability";
import { env } from "../env.mjs";
import { createLambdaClient } from "../optimization_studio/server/lambda";
import {
  deleteStagedObject,
  STAGED_PAYLOAD_HEADER,
  type StagedObject,
  stagePayloadToS3,
} from "../server/s3/stagePayload";

const logger = createLogger("langwatch:lambdaFetch");

// Built-in fallback so a deploy with LANGEVALS_STAGING_THRESHOLD_BYTES unset
// still stages below the 6 MiB (6291456 bytes) AWS sync-invoke cap instead of
// silently inlining oversized bodies. Mirrors the studio invoke path
// (optimization_studio/server/lambda/index.ts STUDIO_INVOKE_STAGING_THRESHOLD_BYTES).
const INVOKE_STAGING_THRESHOLD_BYTES_DEFAULT = 5 * 1024 * 1024;
const INVOKE_STAGING_PREFIX = "nlpgo-staging";

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
};

type LambdaFetchResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<T>;
  text: () => Promise<string>;
};

export const lambdaFetch = async <T>(
  urlOrArn: string,
  path: string,
  init?: LambdaFetchInit,
): Promise<LambdaFetchResponse<T>> => {
  // If it's a Lambda ARN
  if (urlOrArn.startsWith("arn:aws:lambda")) {
    const lambda = createLambdaClient();

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

    let response;
    try {
      response = await lambda.send(command);
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

    const responsePayload = response.Payload
      ? Buffer.from(response.Payload).toString("utf-8")
      : "";

    const actualBody =
      responsePayload.split("\u0000").filter(Boolean).pop() ?? "";

    const statusCode = response.StatusCode ?? 200;

    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      statusText: response.FunctionError ?? "OK",
      json: async () => {
        return JSON.parse(actualBody);
      },
      text: async () => actualBody,
    };
  }

  // If it's a regular URL
  const response = await fetch(urlOrArn + path, init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<T>,
    text: () => response.text(),
  };
};
