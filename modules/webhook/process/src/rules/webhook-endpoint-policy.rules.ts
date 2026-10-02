import {
  WebhookEndpointValidationError,
  isValidEventSelector,
  type SqsDestinationInput,
  type WebhookDeliveryControls,
  type WebhookDestinationKind,
} from "@langwatch/webhook-contract";

import { inspectSqsQueueUrl } from "./sqs-queue-url.rules.ts";
import {
  findUrlProblem,
  isRoleArn,
  sqsCredentialMode,
  type WebhookUrlProblemCode,
} from "./webhook-destination.rules.ts";

export type WebhookEndpointConfigurationInput = {
  allowInsecureLocalUrls?: boolean;
  allowAmbientAwsCredentials?: boolean;
};

export type WebhookEndpointConfiguration = Readonly<{
  allowInsecureLocalUrls: boolean;
  allowAmbientAwsCredentials: boolean;
}>;

export function webhookEndpointConfiguration(
  input: WebhookEndpointConfigurationInput = {},
): WebhookEndpointConfiguration {
  return {
    allowInsecureLocalUrls: input.allowInsecureLocalUrls ?? false,
    allowAmbientAwsCredentials: input.allowAmbientAwsCredentials ?? false,
  };
}

export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 72 * 60 * 60 * 1000;
export const WEBHOOK_DISABLED_REASON_AUTO = "auto_failures_72h";
export const WEBHOOK_DISABLED_REASON_MANUAL = "manual";
export const WEBHOOK_MAX_BATCH_SIZE_BOUNDS = { min: 1, max: 100 } as const;
export const WEBHOOK_BATCH_DELAY_BOUNDS_MS = { min: 0, max: 60_000 } as const;
export const WEBHOOK_IN_FLIGHT_BOUNDS = { min: 1, max: 8 } as const;

function assertControlInBounds(
  name: string,
  value: number,
  bounds: { min: number; max: number },
): void {
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new WebhookEndpointValidationError(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
}

export function assertValidDeliveryControls(controls: Partial<WebhookDeliveryControls>): void {
  if (controls.maxBatchSize !== undefined) {
    assertControlInBounds("max_batch_size", controls.maxBatchSize, WEBHOOK_MAX_BATCH_SIZE_BOUNDS);
  }

  if (controls.maxBatchDelayMs !== undefined) {
    assertControlInBounds(
      "max_batch_delay_ms",
      controls.maxBatchDelayMs,
      WEBHOOK_BATCH_DELAY_BOUNDS_MS,
    );
  }

  if (controls.maxInFlight !== undefined) {
    assertControlInBounds("max_in_flight", controls.maxInFlight, WEBHOOK_IN_FLIGHT_BOUNDS);
  }
}

/** This surface's wording for each URL admission problem; the rule itself is `findUrlProblem`. */
const URL_PROBLEM_MESSAGES: Record<WebhookUrlProblemCode, string> = {
  invalid_url: "url must be a valid URL",
  scheme: "url must use https",
  host: "url must have a host",
  port: "url must use the default https port (443)",
  credentials: "url must not carry credentials",
};

/** Stands in for a stored secret the caller did not resend, so the credential-pair rule is
 *  judged on the shape the endpoint will actually have. */
export const WEBHOOK_KEPT_SECRET = "__langwatch_kept_secret__";

/** Same policy the sender enforces at dispatch, so an endpoint that saves can deliver. */
export function assertValidUrl(url: string, configuration: WebhookEndpointConfiguration): void {
  const problem = findUrlProblem(url, configuration.allowInsecureLocalUrls);
  if (problem) throw new WebhookEndpointValidationError(URL_PROBLEM_MESSAGES[problem]);
}

export function assertValidEvents(enabledEvents: string[]): void {
  if (enabledEvents.length === 0) {
    throw new WebhookEndpointValidationError("enabled_events must select at least one event type");
  }
  for (const selector of enabledEvents) {
    if (!isValidEventSelector(selector)) {
      throw new WebhookEndpointValidationError(`unknown event selector "${selector}"`);
    }
  }
}

/**
 * Admission for a queue destination. The queue URL never passes the SSRF fence (the AWS SDK
 * dials it, not us), so the canonical SQS URL shape IS the fence. Ambient credentials would
 * write with the deployment's identity, which can reach other tenants' queues.
 */
export function assertValidSqsDestination(
  sqs: SqsDestinationInput,
  configuration: WebhookEndpointConfiguration,
): void {
  const inspection = inspectSqsQueueUrl(sqs.queueUrl);
  if (!inspection.ok) {
    throw new WebhookEndpointValidationError(
      inspection.problem === "fifo"
        ? "sqs.queue_url must name a standard queue; FIFO queues are not supported. Deliveries are at-least-once and deduplicated on the envelope id, which is what a standard queue provides."
        : "sqs.queue_url must be an Amazon SQS queue URL, like https://sqs.<region>.amazonaws.com/<account id>/<queue name>",
    );
  }
  if (sqs.roleArn && !isRoleArn(sqs.roleArn)) {
    throw new WebhookEndpointValidationError(
      "sqs.role_arn must be an IAM role ARN, like arn:aws:iam::<account id>:role/<role name>",
    );
  }
  if (sqs.externalId && !sqs.roleArn) {
    throw new WebhookEndpointValidationError(
      "sqs.external_id only applies with sqs.role_arn, which names the role to assume",
    );
  }
  if (Boolean(sqs.accessKeyId) !== Boolean(sqs.secretAccessKey)) {
    throw new WebhookEndpointValidationError(
      "sqs.access_key_id and sqs.secret_access_key are set together or not at all",
    );
  }
  const mode = sqsCredentialMode({ roleArn: sqs.roleArn, accessKeyId: sqs.accessKeyId });
  if (mode === "ambient" && !configuration.allowAmbientAwsCredentials) {
    throw new WebhookEndpointValidationError(
      "sqs needs credentials of its own: either sqs.role_arn for a role to assume, or sqs.access_key_id with sqs.secret_access_key",
    );
  }
}

/** A new endpoint's destination as asked for: the fields its kind needs, none of the other's. */
export function assertValidDestinationInput(
  params: { destinationKind: WebhookDestinationKind; url?: string; sqs?: SqsDestinationInput },
  configuration: WebhookEndpointConfiguration,
): void {
  if (params.destinationKind === "http") {
    if (!params.url) {
      throw new WebhookEndpointValidationError("url is required for an http endpoint");
    }
    if (params.sqs) {
      throw new WebhookEndpointValidationError("sqs does not apply to an http endpoint");
    }
    assertValidUrl(params.url, configuration);
    return;
  }
  if (!params.sqs?.queueUrl) {
    throw new WebhookEndpointValidationError("sqs.queue_url is required for an sqs endpoint");
  }
  if (params.url) {
    throw new WebhookEndpointValidationError(
      "url does not apply to an sqs endpoint; name the queue in sqs.queue_url",
    );
  }
  assertValidSqsDestination(params.sqs, configuration);
}

/** An update may adjust the destination it has, never swap it: batches already planned against
 *  the old transport sit in the outbox with the old shape. */
export function assertDestinationUnchanged({
  currentKind,
  params,
}: {
  currentKind: WebhookDestinationKind;
  params: { destinationKind?: WebhookDestinationKind; url?: string; sqs?: unknown };
}): void {
  if (params.destinationKind !== undefined && params.destinationKind !== currentKind) {
    throw new WebhookEndpointValidationError(
      `destination_kind cannot be changed after an endpoint is created; create a new endpoint for the ${params.destinationKind} destination and archive this one once it has drained`,
    );
  }
  if (params.url !== undefined && currentKind !== "http") {
    throw new WebhookEndpointValidationError(
      "url does not apply to this endpoint; it delivers to an Amazon SQS queue",
    );
  }
  if (params.sqs !== undefined && currentKind !== "sqs") {
    throw new WebhookEndpointValidationError(
      "sqs does not apply to this endpoint; it delivers over HTTPS",
    );
  }
}

function selects(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Only the selected mode's credentials, so the row says what the read view says. */
function withExclusiveCredentials(sqs: SqsDestinationInput): SqsDestinationInput {
  if (sqs.roleArn) return { ...sqs, accessKeyId: null, secretAccessKey: null };
  if (sqs.accessKeyId) return { ...sqs, roleArn: null, externalId: null };
  return { ...sqs, roleArn: null, externalId: null, accessKeyId: null, secretAccessKey: null };
}

type StoredSqsDestination = {
  queueUrl: string | null;
  roleArn: string | null;
  externalId: string | null;
  accessKeyId: string | null;
  hasSecretAccessKey: boolean;
};

/** Each credential field: cleared when the request chose the other mode, else what the request
 *  sent, else what the row held. */
function mergedSqsDestination({
  stored,
  sqs,
  selectsRole,
  selectsStatic,
}: {
  stored: StoredSqsDestination;
  sqs: Partial<SqsDestinationInput>;
  selectsRole: boolean;
  selectsStatic: boolean;
}): SqsDestinationInput {
  const merged: SqsDestinationInput = {
    queueUrl: sqs.queueUrl ?? stored.queueUrl ?? "",
    roleArn: null,
    externalId: null,
    accessKeyId: null,
    secretAccessKey: null,
  };
  if (!selectsStatic) {
    merged.roleArn = sqs.roleArn === undefined ? stored.roleArn : sqs.roleArn;
    merged.externalId = sqs.externalId === undefined ? stored.externalId : sqs.externalId;
  }
  if (!selectsRole) {
    merged.accessKeyId = sqs.accessKeyId === undefined ? stored.accessKeyId : sqs.accessKeyId;
    const keptSecret = stored.hasSecretAccessKey ? WEBHOOK_KEPT_SECRET : null;
    merged.secretAccessKey = sqs.secretAccessKey === undefined ? keptSecret : sqs.secretAccessKey;
  }
  return merged;
}

/**
 * A partial queue update, merged over the stored destination and validated as the whole it
 * becomes. The credential mode is read from what THIS request named, so a stored role never
 * outranks a key pair just sent. A kept secret reads as `WEBHOOK_KEPT_SECRET`.
 */
export function mergeSqsUpdate({
  stored,
  sqs,
  configuration,
}: {
  stored: StoredSqsDestination;
  sqs: Partial<SqsDestinationInput>;
  configuration: WebhookEndpointConfiguration;
}): SqsDestinationInput {
  const selectsRole = selects(sqs.roleArn);
  const selectsStatic = selects(sqs.accessKeyId);
  if (selectsRole && selectsStatic) {
    throw new WebhookEndpointValidationError(
      "sqs.role_arn and sqs.access_key_id select different credential modes; send one of them, and null for the other",
    );
  }
  const exclusive = withExclusiveCredentials(
    mergedSqsDestination({ stored, sqs, selectsRole, selectsStatic }),
  );
  assertValidSqsDestination(exclusive, configuration);
  return exclusive;
}
