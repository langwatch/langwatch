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
 * A single SQS message tops out at 256 KiB, counting the body AND the
 * attributes (names, types and values all count).
 */
export const SQS_MAX_MESSAGE_BYTES = 262_144;

/** Attribute names are the HTTP header names, verbatim. */
const ATTEMPT_ATTRIBUTE = "X-LangWatch-Delivery-Attempt";
const TEST_FIRE_ATTRIBUTE = "X-LangWatch-Test-Fire";

/**
 * What one message weighs against the 256 KiB limit: the body plus every
 * attribute's name, type and value, all as UTF-8 bytes. Measured before the
 * send, because a message over the limit is refused by the API and there is
 * nothing about the next attempt that would make the same bytes fit.
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
  testFire = false,
}: {
  batchId: string;
  attempt: number;
  signature: string | null;
  testFire?: boolean;
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
    ...(testFire
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
    ...(request.testFire ? { testFire: true } : {}),
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
      `Batch is ${bytes} bytes, over the ${SQS_MAX_MESSAGE_BYTES}-byte Amazon SQS message limit. ` +
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
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return {
      verdict,
      status: null,
      body: "",
      dispatchId: batchId,
      error: `${reason}: ${detail}`.slice(0, ERROR_SNIPPET_CHARS),
    };
  } finally {
    client.destroy();
  }
}

export function sqsWebhookDestination(
  config: SqsDestinationConfig,
  deps: { createClient?: (queueUrl: string) => SQSClient } = {},
): WebhookDestination {
  return {
    kind: "sqs",
    async send(
      request: WebhookDispatchRequest,
    ): Promise<WebhookDispatchResult> {
      // The same cap the HTTPS transport answers to, called here directly
      // because a queue send never passes through the HTTP sender that used
      // to own it. Without this line a queue endpoint would be uncapped. A
      // test fire is exempt, exactly as it is on the HTTPS side.
      if (!request.testFire) {
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
        client: (deps.createClient ?? createSqsClient(config))(config.queueUrl),
        queueUrl: config.queueUrl,
        body: request.body,
        attributes,
        batchId: request.batchId,
      });
    },
  };
}

/**
 * The client for one endpoint's queue. Region and the dialed host come off
 * the queue URL, so neither can be configured into disagreeing with it, and
 * `maxAttempts: 1` keeps the SDK from retrying underneath the delivery ladder
 * that is already counting attempts.
 */
function createSqsClient(config: SqsDestinationConfig) {
  return (queueUrl: string): SQSClient => {
    const parsed = parseSqsQueueUrl(queueUrl);
    return new SQSClient(
      buildAwsClientConfig({
        region: parsed?.region,
        targetHost: sqsHostFor(queueUrl),
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
  };
}
