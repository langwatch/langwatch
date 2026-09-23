import type { MessageAttributeValue } from "@aws-sdk/client-sqs";
import {
  assertDispatchBudget,
  signWebhookPayload,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDispatchRateLimiter,
} from "@langwatch/egress";
import { nowInstant } from "@langwatch/time";

import {
  type WebhookDestination,
  type WebhookDispatchRequest,
  type WebhookDispatchResult,
} from "../app/webhook.app.ts";
import {
  type SqsDestinationConfig,
  type SqsWebhookSender,
} from "../channels/webhook-destination.channel.ts";

export type {
  AwsClientConfigResolver,
  SqsDestinationConfig,
} from "../channels/webhook-destination.channel.ts";

/**
 * The Amazon SQS destination: the same batch, the same bytes, the same signature, put on a
 * queue instead of posted to a URL.
 */

/**
 * How large one delivery may be, counting the body AND the attributes (names, types and values
 * all count). This is OUR cap, not the queue's: Amazon SQS accepts a message up to 1 MiB.
 */
export const SQS_MAX_MESSAGE_BYTES = 262_144;

/** Attribute names are the HTTP header names, verbatim. */
const ATTEMPT_ATTRIBUTE = "X-LangWatch-Delivery-Attempt";
const TEST_FIRE_ATTRIBUTE = "X-LangWatch-Test-Fire";

/**
 * What one message weighs against {@link SQS_MAX_MESSAGE_BYTES}: the body plus every
 * attribute's name, type and value, all as UTF-8 bytes. Measured before the send, because there
 * is nothing about the next attempt that would make the same bytes fit.
 */
function sqsMessageBytes({
  body,
  attributes,
}: {
  body: string;
  attributes: Record<string, MessageAttributeValue>;
}): number {
  let bytes = Buffer.byteLength(body, "utf8");
  for (const [name, value] of Object.entries(attributes)) {
    bytes += Buffer.byteLength(name, "utf8");
    bytes += Buffer.byteLength(value.DataType ?? "", "utf8");
    bytes += Buffer.byteLength(value.StringValue ?? "", "utf8");
  }
  return bytes;
}

/**
 * The message attributes one delivery carries. Names carry over from the
 * HTTP headers verbatim, so the same receiver logic reads either transport.
 */
function sqsMessageAttributes({
  batchId,
  attempt,
  signature,
  isTestFire = false,
}: {
  batchId: string;
  attempt: number;
  signature: string | null;
  isTestFire?: boolean;
}): Record<string, MessageAttributeValue> {
  return {
    [WEBHOOK_DELIVERY_ID_HEADER]: { DataType: "String", StringValue: batchId },
    [ATTEMPT_ATTRIBUTE]: { DataType: "String", StringValue: String(attempt) },
    ...(signature
      ? {
          [WEBHOOK_SIGNATURE_HEADER]: {
            DataType: "String",
            StringValue: signature,
          },
        }
      : {}),
    ...(isTestFire ? { [TEST_FIRE_ATTRIBUTE]: { DataType: "String", StringValue: "true" } } : {}),
  };
}

/**
 * Errors that mean the queue will never accept this message as configured.
 * Retrying spends the whole ladder learning the same thing, so they retire
 * the batch immediately and the delivery log says why.
 */
const TERMINAL_ERROR_NAMES = new Set([
  "AWS.SimpleQueueService.NonExistentQueue",
  "QueueDoesNotExist",
  "AccessDenied",
  "AccessDeniedException",
  "AuthorizationError",
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "InvalidAddress",
  "InvalidParameterValue",
  "MissingParameter",
  "AWS.SimpleQueueService.UnsupportedOperation",
  "InvalidSecurity",
  "KMS.AccessDeniedException",
  "KMS.NotFoundException",
  "KMS.DisabledException",
  "KMS.InvalidStateException",
]);

/**
 * Errors that are this moment's problem rather than this configuration's. `ExpiredToken` is
 * deliberately here: an SSO session expiring mid-run is a credential that will be refreshed,
 * and calling it terminal would make an expiring session look exactly like a dead queue.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "ThrottlingException",
  "Throttling",
  "RequestThrottled",
  "RequestThrottledException",
  "TooManyRequestsException",
  "ServiceUnavailable",
  "InternalError",
  "InternalFailure",
  "RequestTimeout",
  "RequestTimeoutException",
  "AWS.SimpleQueueService.QueueDeletedRecently",
  "ExpiredToken",
  "ExpiredTokenException",
  "RequestExpired",
  "AWS.SimpleQueueService.PurgeQueueInProgress",
]);

/** Node network failures, which the SDK surfaces with the OS error code. */
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Retry or retire, from what the SDK threw. Unknown failures are RETRYABLE.
 */
/** The three things an SDK failure can tell us apart by. */
function failureShape(error: unknown): {
  name: string;
  code: string;
  httpStatus: number | undefined;
} {
  if (typeof error !== "object" || error === null) {
    return { name: "", code: "", httpStatus: undefined };
  }
  const metadata = Reflect.get(error, "$metadata") ?? {};
  return {
    name: (Reflect.get(error, "name") as string | undefined) ?? "",
    code: (Reflect.get(error, "code") as string | undefined) ?? "",
    httpStatus: Reflect.get(metadata, "httpStatusCode") as number | undefined,
  };
}

/** The verdict a status code alone implies: 5xx and throttling are this
 *  moment, a 4xx we do not recognize is the request itself, which the next
 *  attempt would send again unchanged. */
function verdictFromStatus(httpStatus: number): "retryable" | "terminal" {
  return httpStatus >= 500 || httpStatus === 429 ? "retryable" : "terminal";
}

/**
 * Failures that say "the identity we are using is not accepted right now". These are the ones a
 * customer repairs on their side, by fixing the role's trust policy or the key's permissions,
 * and the repair is invisible to us.
 */
const STALE_CREDENTIAL_ERROR_NAMES = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "AuthorizationError",
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "InvalidSecurity",
  "ExpiredToken",
  "ExpiredTokenException",
  "CredentialsProviderError",
]);

/** Whether this failure means the cached client's identity is worth rebuilding. */
function isStaleCredentialFailure(error: unknown): boolean {
  const { name, code } = failureShape(error);
  return STALE_CREDENTIAL_ERROR_NAMES.has(name) || STALE_CREDENTIAL_ERROR_NAMES.has(code);
}

function classifySqsFailure(error: unknown): {
  verdict: "retryable" | "terminal";
  reason: string;
} {
  const { name, code, httpStatus } = failureShape(error);
  const named = name || code;

  const isTerminal = TERMINAL_ERROR_NAMES.has(name) || TERMINAL_ERROR_NAMES.has(code);
  if (isTerminal) {
    return { verdict: "terminal", reason: named };
  }
  const isRetryable = RETRYABLE_ERROR_NAMES.has(name) || RETRYABLE_ERROR_NAMES.has(code);
  if (isRetryable) {
    return { verdict: "retryable", reason: named };
  }
  if (RETRYABLE_NETWORK_CODES.has(code)) {
    return { verdict: "retryable", reason: code };
  }
  if (httpStatus !== undefined) {
    return {
      verdict: verdictFromStatus(httpStatus),
      reason: named || `HTTP ${httpStatus}`,
    };
  }
  return { verdict: "retryable", reason: named || "unknown" };
}

/** How much of a failure rides in the delivery log's error column. */
const ERROR_SNIPPET_CHARS = 500;

/** The attributes one delivery rides with, signature included. */
function attributesFor(request: WebhookDispatchRequest): Record<string, MessageAttributeValue> {
  const signature =
    request.signingSecrets.length > 0
      ? signWebhookPayload({
          secrets: request.signingSecrets,
          body: request.body,
          timestampSeconds: Math.floor(nowInstant().epochMilliseconds / 1000),
        })
      : null;
  return sqsMessageAttributes({
    batchId: request.batchId,
    attempt: request.attempt,
    signature,
    ...(request.isTestFire ? { isTestFire: true } : {}),
  });
}

/**
 * The refusal for a batch no queue message can carry, or null when it fits. Terminal, and it
 * says what to change: the same bytes will never fit, and splitting is not on the table because
 * one batch is one message and the batch id is the replay-safety key.
 */
function oversizeRefusal({
  bytes,
  batchId,
}: {
  bytes: number;
  batchId: string;
}): WebhookDispatchResult | null {
  if (bytes <= SQS_MAX_MESSAGE_BYTES) return null;
  return {
    verdict: "terminal",
    status: null,
    body: "",
    dispatchId: batchId,
    error:
      `Batch is ${bytes} bytes, over the ${SQS_MAX_MESSAGE_BYTES}-byte limit for one delivery. ` +
      "Lower the endpoint's maximum batch size so each delivery carries fewer events.",
  };
}

/** The send itself, and whatever the queue answered, as a verdict. */
async function putOnQueue({
  channel,
  config,
  queueUrl,
  body,
  attributes,
  batchId,
}: {
  channel: SqsWebhookSender;
  config: SqsDestinationConfig;
  queueUrl: string;
  body: string;
  attributes: Record<string, MessageAttributeValue>;
  batchId: string;
}): Promise<WebhookDispatchResult> {
  try {
    const messageId = await channel.send({ config, body, attributes });
    return {
      verdict: "success",
      // A queue has no status to report, and inventing one (200) would make
      // the delivery log lie about what answered.
      status: null,
      body: messageId,
      dispatchId: batchId,
    };
  } catch (error) {
    const { verdict, reason } = classifySqsFailure(error);
    if (isStaleCredentialFailure(error)) {
      // The customer fixes this on their side, and we never hear about it, so
      // the next attempt has to ask for credentials again rather than reuse a
      // provider that already resolved against the old permissions.
      channel.invalidate(queueUrl);
    }
    const detail = error instanceof Error ? error.message : (JSON.stringify(error) ?? "");
    return {
      verdict,
      status: null,
      body: "",
      dispatchId: batchId,
      error: `${reason}: ${detail}`.slice(0, ERROR_SNIPPET_CHARS),
    };
  }
}

export interface SqsWebhookDestinationAdapterOptions extends SqsDestinationConfig {
  /** The process-owned SQS transport. */
  channel: SqsWebhookSender;
  /**
   * Where the hourly dispatch cap is counted. Optional only because the
   * cap is a limit, not a gate: a process without a shared counter delivers
   * uncapped rather than refusing every queue endpoint it holds.
   */
  rateLimiter?: WebhookDispatchRateLimiter | undefined;
}

export class SqsWebhookDestinationAdapter implements WebhookDestination {
  readonly kind = "sqs" as const;

  private constructor(private readonly config: SqsWebhookDestinationAdapterOptions) {}

  static create({
    config,
  }: {
    config: SqsWebhookDestinationAdapterOptions;
  }): SqsWebhookDestinationAdapter {
    return new SqsWebhookDestinationAdapter(config);
  }

  /** How large one delivery is, body and attributes together. */
  static messageBytes(args: {
    body: string;
    attributes: Record<string, MessageAttributeValue>;
  }): number {
    return sqsMessageBytes(args);
  }

  /** The message attributes one delivery carries. */
  static messageAttributes(args: {
    batchId: string;
    attempt: number;
    signature: string | null;
    isTestFire?: boolean;
  }): Record<string, MessageAttributeValue> {
    return sqsMessageAttributes(args);
  }

  /** Retry or retire, from what the SDK threw. */
  static classifyFailure(error: unknown): { verdict: "retryable" | "terminal"; reason: string } {
    return classifySqsFailure(error);
  }

  /** Whether this failure means the cached client's identity is worth rebuilding. */
  static isStaleCredentialFailure(error: unknown): boolean {
    return isStaleCredentialFailure(error);
  }

  async send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult> {
    const { channel, rateLimiter } = this.config;
    // The same cap the HTTPS transport answers to, called here directly
    // because a queue send never passes through the HTTP sender that used
    // to own it. Without this line a queue endpoint would be uncapped. A
    // test fire is exempt, exactly as it is on the HTTPS side.
    if (!request.isTestFire && rateLimiter) {
      await assertDispatchBudget({
        rateLimiter,
        scopeId: request.organizationId,
        label: `Webhook endpoint ${request.endpointId}`,
      });
    }

    const attributes = attributesFor(request);
    const refusal = oversizeRefusal({
      bytes: sqsMessageBytes({ body: request.body, attributes }),
      batchId: request.batchId,
    });
    if (refusal) return refusal;

    return putOnQueue({
      channel,
      config: this.config,
      queueUrl: this.config.queueUrl,
      body: request.body,
      attributes,
      batchId: request.batchId,
    });
  }
}
