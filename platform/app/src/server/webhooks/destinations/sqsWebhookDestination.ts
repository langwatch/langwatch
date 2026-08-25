import { createHash } from "node:crypto";
import {
  type MessageAttributeValue,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { buildAwsClientConfig } from "~/server/aws/awsClientConfig";
import { assertDispatchBudget } from "../dispatchBudget";
import { WEBHOOK_DELIVERY_ID_HEADER } from "../sendWebhook";
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from "../signature";
import { parseSqsQueueUrl, sqsHostFor } from "./sqsQueueUrl";
import type {
  WebhookDestination,
  WebhookDispatchRequest,
  WebhookDispatchResult,
} from "./types";

/**
 * The Amazon SQS destination: the same batch, the same bytes, the same
 * signature, put on a queue instead of posted to a URL.
 *
 * **The body is byte-identical to the HTTP body.** `MessageBody` is the exact
 * `{"batch":[...]}` JSON the HTTPS transport would have posted, and the
 * signature, the delivery id and the attempt ride as message attributes under
 * the SAME NAMES they use as HTTP headers. So a consumer verifies with the
 * same call, over the same bytes, against the same golden vectors, and a
 * customer can move an integration from HTTP to a queue without touching
 * their verification code.
 *
 * An outer JSON wrapper was rejected for exactly that reason: it would force
 * a re-encode, which is a second chance to break the raw-bytes rule that
 * signature verification depends on, and it would spend the message size
 * limit on structure.
 *
 * **The footgun, first, because every consumer hits it:** `ReceiveMessage`
 * returns NO message attributes unless you ask for them by name. Pass
 * `MessageAttributeNames: ["All"]`. Forget it and the consumer sees a body
 * with no signature beside it and rejects every delivery it is sent.
 */

/**
 * How large one delivery may be, counting the body AND the attributes (names,
 * types and values all count).
 *
 * This is OUR cap, not the queue's: Amazon SQS accepts a message up to 1 MiB.
 * A batch is one message, so the cap is what bounds how much a consumer must
 * hold in memory for a single receive, and lowering an endpoint's maximum
 * batch size is the way past it.
 */
export const SQS_MAX_MESSAGE_BYTES = 262_144;

/** Attribute names are the HTTP header names, verbatim. */
const ATTEMPT_ATTRIBUTE = "X-LangWatch-Delivery-Attempt";
const TEST_FIRE_ATTRIBUTE = "X-LangWatch-Test-Fire";

/**
 * What one message weighs against {@link SQS_MAX_MESSAGE_BYTES}: the body plus
 * every attribute's name, type and value, all as UTF-8 bytes. Measured before
 * the send, because there is nothing about the next attempt that would make
 * the same bytes fit.
 */
export function sqsMessageBytes({
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
export function sqsMessageAttributes({
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
    ...(isTestFire
      ? { [TEST_FIRE_ATTRIBUTE]: { DataType: "String", StringValue: "true" } }
      : {}),
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
 * Errors that are this moment's problem rather than this configuration's.
 *
 * `ExpiredToken` is deliberately here: an SSO session expiring mid-run is a
 * credential that will be refreshed, and calling it terminal would make an
 * expiring session look exactly like a dead queue.
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
 * Retry or retire, from what the SDK threw.
 *
 * Unknown failures are RETRYABLE. A queue we have never seen fail this way
 * before is more likely a passing condition than a permanent misconfiguration,
 * and the ladder gives up on its own after eleven attempts, whereas a wrongly
 * terminal verdict drops a billing event on the floor with no second chance.
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
 * Failures that say "the identity we are using is not accepted right now".
 *
 * These are the ones a customer repairs on their side, by fixing the role's
 * trust policy or the key's permissions, and the repair is invisible to us.
 * The cached client holds a credential provider that has already resolved, so
 * without dropping it the repair does not take effect until the process
 * restarts. Hand testing hit exactly that: a trust policy corrected while the
 * app was running kept answering AccessDenied, and the same role assumed
 * cleanly from the AWS CLI with the same key and external id at the same time.
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
export function isStaleCredentialFailure(error: unknown): boolean {
  const { name, code } = failureShape(error);
  return STALE_CREDENTIAL_ERROR_NAMES.has(name) || STALE_CREDENTIAL_ERROR_NAMES.has(code);
}

export function classifySqsFailure(error: unknown): {
  verdict: "retryable" | "terminal";
  reason: string;
} {
  const { name, code, httpStatus } = failureShape(error);
  const named = name || code;

  if (TERMINAL_ERROR_NAMES.has(name) || TERMINAL_ERROR_NAMES.has(code)) {
    return { verdict: "terminal", reason: named };
  }
  if (RETRYABLE_ERROR_NAMES.has(name) || RETRYABLE_ERROR_NAMES.has(code)) {
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

export interface SqsDestinationConfig {
  queueUrl: string;
  roleArn?: string | null;
  externalId?: string | null;
  accessKeyId?: string | null;
  /** Decrypted at dispatch, never stored or logged in the clear. */
  secretAccessKey?: string | null;
}

/** How much of a failure rides in the delivery log's error column. */
const ERROR_SNIPPET_CHARS = 500;

/** The attributes one delivery rides with, signature included. */
function attributesFor(
  request: WebhookDispatchRequest,
): Record<string, MessageAttributeValue> {
  const signature =
    request.signingSecrets.length > 0
      ? signWebhookPayload({
          secrets: request.signingSecrets,
          body: request.body,
          timestampSeconds: Math.floor(Date.now() / 1000),
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
 * The refusal for a batch no queue message can carry, or null when it fits.
 *
 * Terminal, and it says what to change: the same bytes will never fit, and
 * splitting is not on the table because one batch is one message and the
 * batch id is the replay-safety key.
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
  client,
  queueUrl,
  body,
  attributes,
  batchId,
}: {
  client: SQSClient;
  queueUrl: string;
  body: string;
  attributes: Record<string, MessageAttributeValue>;
  batchId: string;
}): Promise<WebhookDispatchResult> {
  try {
    const answer = await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageAttributes: attributes,
      }),
    );
    return {
      verdict: "success",
      // A queue has no status to report, and inventing one (200) would make
      // the delivery log lie about what answered.
      status: null,
      body: answer.MessageId ?? "",
      dispatchId: batchId,
    };
  } catch (error) {
    const { verdict, reason } = classifySqsFailure(error);
    if (isStaleCredentialFailure(error)) {
      // The customer fixes this on their side, and we never hear about it, so
      // the next attempt has to ask for credentials again rather than reuse a
      // provider that already resolved against the old permissions.
      dropSqsClient(queueUrl);
    }
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return {
      verdict,
      status: null,
      body: "",
      dispatchId: batchId,
      error: `${reason}: ${detail}`.slice(0, ERROR_SNIPPET_CHARS),
    };
  }
}

export function sqsWebhookDestination(
  config: SqsDestinationConfig,
  deps: { createClient?: (config: SqsDestinationConfig) => SQSClient } = {},
): WebhookDestination {
  return {
    kind: "sqs",
    async send(request: WebhookDispatchRequest): Promise<WebhookDispatchResult> {
      // The same cap the HTTPS transport answers to, called here directly
      // because a queue send never passes through the HTTP sender that used
      // to own it. Without this line a queue endpoint would be uncapped. A
      // test fire is exempt, exactly as it is on the HTTPS side.
      if (!request.isTestFire) {
        await assertDispatchBudget({
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

      return await putOnQueue({
        client: (deps.createClient ?? sqsClientFor)(config),
        queueUrl: config.queueUrl,
        body: request.body,
        attributes,
        batchId: request.batchId,
      });
    },
  };
}

/**
 * The client for one endpoint's queue, cached and reused.
 *
 * A client per delivery would be two costs on the hot path. An assumed-role
 * provider caches its STS session INSIDE the provider instance, so a fresh one
 * per send re-assumes the role on every attempt, which is a round trip per
 * delivery and a straight line to an STS `ThrottlingException` that our own
 * ladder then retries by assuming the role again. And a destroyed client tears
 * down its connection pool, so every delivery pays a TLS handshake, which is
 * the opposite of what the shared socket-pool cache exists for.
 *
 * The key is the queue plus every credential field, so rotating a secret or
 * swapping a role produces a new client rather than reusing one that
 * authenticates as the old identity.
 */
const clients = new Map<string, SQSClient>();

/** Cannot appear in a queue URL or in any credential field. */
const KEY_SEPARATOR = "\u0000";

/** Distinct per queue AND per credential, so a rotation is a different key. */
function clientCacheKey(config: SqsDestinationConfig): string {
  return [
    config.queueUrl,
    config.roleArn ?? "",
    config.externalId ?? "",
    config.accessKeyId ?? "",
    // The secret decides identity as much as the key id does, and it must not
    // be readable from a cache key, so it is reduced to a fingerprint.
    config.secretAccessKey
      ? createHash("sha256").update(config.secretAccessKey).digest("hex")
      : "",
  ].join(KEY_SEPARATOR);
}

export function sqsClientFor(config: SqsDestinationConfig): SQSClient {
  const key = clientCacheKey(config);
  const cached = clients.get(key);
  if (cached) return cached;

  const parsed = parseSqsQueueUrl(config.queueUrl);
  const client = new SQSClient(
    buildAwsClientConfig({
      // Region and the dialed host come off the queue URL, so neither can be
      // configured into disagreeing with it.
      region: parsed?.region,
      targetHost: sqsHostFor(config.queueUrl),
      // Our delivery ladder is already counting attempts; SDK retries
      // underneath it would make one recorded attempt several real calls.
      disableSdkRetries: true,
      ...(config.roleArn
        ? {
            assumeRole: {
              roleArn: config.roleArn,
              externalId: config.externalId,
              sessionName: "langwatch-webhooks",
            },
          }
        : {}),
      staticCredentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  );
  clients.set(key, client);
  return client;
}

/**
 * Drop every cached client for one queue, whatever credentials they hold.
 *
 * The queue alone is the key here, rather than the full credential key, because
 * the caller is reacting to a rejection and does not know which of the cached
 * identities for that queue is the stale one. There is normally exactly one.
 */
export function dropSqsClient(queueUrl: string): void {
  for (const [key, client] of clients) {
    if (key.split(KEY_SEPARATOR)[0] === queueUrl) {
      client.destroy();
      clients.delete(key);
    }
  }
}

/** Drop every cached client. For tests, and for a process winding down. */
export function resetSqsClientCache(): void {
  for (const client of clients.values()) client.destroy();
  clients.clear();
}
