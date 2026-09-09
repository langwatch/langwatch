// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";
import type { WebhookUrlProblemCode } from "@langwatch/automations/providers/webhook";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type {
  PrismaClient,
  WebhookDeliveryOutcome,
  WebhookEndpoint,
} from "~/generated/prisma/client";
import { pruneWebhookDeliveries } from "~/server/webhooks/deliveryLog";
import type { WebhookDestinationConfig } from "~/server/webhooks/destinations";
import {
  allowsAmbientAwsCredentials,
  isRoleArn,
  type SqsCredentialMode,
  sqsCredentialMode,
} from "~/server/webhooks/destinations/sqsCredentials";
import {
  inspectSqsQueueUrl,
  parseSqsQueueUrl,
} from "~/server/webhooks/destinations/sqsQueueUrl";
import { WEBHOOK_PREVIOUS_SECRET_TTL_MS } from "~/server/webhooks/signature";
import {
  allowsInsecureLocalUrls,
  inspectWebhookUrl,
} from "~/server/webhooks/urlPolicy";
import { KSUID_RESOURCES } from "~/utils/constants";
import { decrypt, encrypt } from "~/utils/encryption";
import type { WebhookDestinationKind } from "~/utils/webhookDestinations";
import type { ProcessStore } from "~/server/event-sourcing/process-manager/stores/processStore.types";
import { isValidEventSelector } from "./eventRegistry";
import { endpointStreamRef } from "./process-manager/webhookDelivery.process";

const logger = createLogger("langwatch:webhooks:endpoint-service");

/** 72 hours of unbroken failures auto-disables an endpoint. */
export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 72 * 60 * 60 * 1000;

export const WEBHOOK_DISABLED_REASON_AUTO = "auto_failures_72h";
export const WEBHOOK_DISABLED_REASON_MANUAL = "manual";

/**
 * Server bounds for the per-endpoint delivery controls. Out-of-bounds
 * values are rejected at every write surface with the bound in the error.
 *
 * - Batch size caps at 100, the wire contract's batch ceiling.
 * - The coalescing delay caps at a minute: it is added invoice lag, and
 *   past that the customer should scale receivers, not buffering.
 * - In-flight caps at 8: the dispatcher pool is small, and more parallel
 *   POSTs than that just moves queueing into the receiver.
 */
export const WEBHOOK_MAX_BATCH_SIZE_BOUNDS = { min: 1, max: 100 } as const;
export const WEBHOOK_BATCH_DELAY_BOUNDS_MS = { min: 0, max: 60_000 } as const;
export const WEBHOOK_IN_FLIGHT_BOUNDS = { min: 1, max: 8 } as const;

export interface WebhookDeliveryControls {
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
}

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

export function assertValidDeliveryControls(
  controls: Partial<WebhookDeliveryControls>,
): void {
  if (controls.maxBatchSize !== undefined) {
    assertControlInBounds(
      "max_batch_size",
      controls.maxBatchSize,
      WEBHOOK_MAX_BATCH_SIZE_BOUNDS,
    );
  }
  if (controls.maxBatchDelayMs !== undefined) {
    assertControlInBounds(
      "max_batch_delay_ms",
      controls.maxBatchDelayMs,
      WEBHOOK_BATCH_DELAY_BOUNDS_MS,
    );
  }
  if (controls.maxInFlight !== undefined) {
    assertControlInBounds(
      "max_in_flight",
      controls.maxInFlight,
      WEBHOOK_IN_FLIGHT_BOUNDS,
    );
  }
}

/**
 * The endpoint as asked for cannot be saved: the URL is refused by the
 * admission policy, an event name is not in the catalog, or a delivery
 * control is out of bounds. The message names which, because every one of
 * them is something the caller can correct on the next attempt.
 */
export class WebhookEndpointValidationError extends HandledError {
  declare readonly code: "webhook_endpoint_invalid";

  constructor(message: string) {
    super("webhook_endpoint_invalid", message, {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "WebhookEndpointValidationError";
  }
}

/**
 * No live endpoint in this organization has that id.
 *
 * Archived endpoints answer the same as ids that never existed and as ids
 * belonging to another organization: telling those apart would confirm the
 * existence of another tenant's rows.
 */
export class WebhookEndpointNotFoundError extends HandledError {
  declare readonly code: "webhook_endpoint_not_found";

  constructor() {
    super("webhook_endpoint_not_found", "Webhook endpoint not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "WebhookEndpointNotFoundError";
  }
}

export interface WebhookEndpointView {
  id: string;
  organizationId: string;
  destinationKind: WebhookDestinationKind;
  /** Null on every endpoint that is not an HTTPS one. The database's CHECK
   *  constraint is what guarantees an `http` endpoint always has it. */
  url: string | null;
  sqs: SqsDestinationView | null;
  enabledEvents: string[];
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  disabledAt: Date | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(endpoint: WebhookEndpoint): WebhookEndpointView {
  return {
    id: endpoint.id,
    organizationId: endpoint.organizationId,
    destinationKind: endpoint.destinationKind,
    url: endpoint.url,
    sqs: toSqsView(endpoint),
    enabledEvents: endpoint.enabledEvents,
    status: endpoint.status,
    disabledReason: endpoint.disabledReason,
    disabledAt: endpoint.disabledAt,
    failingSince: endpoint.failingSince,
    lastSuccessAt: endpoint.lastSuccessAt,
    lastFailureAt: endpoint.lastFailureAt,
    maxBatchSize: endpoint.maxBatchSize,
    maxBatchDelayMs: endpoint.maxBatchDelayMs,
    maxInFlight: endpoint.maxInFlight,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

/**
 * This surface's wording for each admission rule. The rule itself lives in the
 * shared `urlPolicy`, which both webhook channels run; only the sentence is
 * local, because a REST integrator reading `url must use https` and a trigger
 * author reading "The webhook URL must use https." want different registers.
 */
const URL_PROBLEM_MESSAGES: Record<WebhookUrlProblemCode, string> = {
  invalid_url: "url must be a valid URL",
  scheme: "url must use https",
  host: "url must have a host",
  port: "url must use the default https port (443)",
  credentials: "url must not carry credentials",
};

function assertValidUrl(url: string): void {
  // Same policy the sender enforces at dispatch, so an endpoint that saves is
  // an endpoint that can deliver. Operator opt-in for local development and
  // internal receivers relaxes the origin here exactly as it relaxes the
  // local-address fence on the send.
  const problem = inspectWebhookUrl({
    url,
    allowInsecureLocal: allowsInsecureLocalUrls(),
  });
  if (problem) {
    throw new WebhookEndpointValidationError(
      URL_PROBLEM_MESSAGES[problem.code],
    );
  }
}

/**
 * The queue an endpoint delivers to, as the customer supplies it.
 *
 * `secretAccessKey` arrives in the clear from the write surface and is
 * encrypted before it is stored; nothing reads it back out.
 */
export interface SqsDestinationInput {
  queueUrl: string;
  roleArn?: string | null;
  externalId?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
}

/** The queue, as any read surface may see it: everything but the secret. */
export interface SqsDestinationView {
  queueUrl: string;
  /** Read off the queue URL, so it can never disagree with the queue. */
  region: string;
  /** Whose queue this is, surfaced so an operator can see it without
   *  decoding a URL by eye. */
  accountId: string;
  queueName: string;
  credentialMode: SqsCredentialMode;
  roleArn: string | null;
  /** Generated by us at save time, pasted by the customer into their role's
   *  trust policy. Not a secret: it is worthless without the role. */
  externalId: string | null;
  /** The key id is an identifier, not a credential. The secret half is never
   *  returned by anything. */
  accessKeyId: string | null;
}

/** Where an endpoint delivers, in one line, for a log or a notification. */
export function describeDestination(
  endpoint: Pick<WebhookEndpoint, "destinationKind" | "url" | "sqsQueueUrl">,
): string {
  return endpoint.destinationKind === "sqs"
    ? (endpoint.sqsQueueUrl ?? "an Amazon SQS queue")
    : (endpoint.url ?? "an HTTPS endpoint");
}

function toSqsView(endpoint: WebhookEndpoint): SqsDestinationView | null {
  if (endpoint.destinationKind !== "sqs" || !endpoint.sqsQueueUrl) return null;
  const parsed = parseSqsQueueUrl(endpoint.sqsQueueUrl);
  return {
    queueUrl: endpoint.sqsQueueUrl,
    // Every stored queue URL passed admission, so the parse succeeds. The
    // fallbacks describe a row written around the service rather than a
    // value invented here.
    region: parsed?.region ?? "",
    accountId: parsed?.accountId ?? "",
    queueName: parsed?.queueName ?? "",
    credentialMode: sqsCredentialMode({
      roleArn: endpoint.sqsRoleArn,
      accessKeyId: endpoint.sqsAccessKeyId,
    }),
    roleArn: endpoint.sqsRoleArn,
    externalId: endpoint.sqsExternalId,
    accessKeyId: endpoint.sqsAccessKeyId,
  };
}

/**
 * Admission for a queue destination: the URL shape, the credential mode, and
 * the gate.
 *
 * The queue URL never passes through the SSRF fence, because we never dial
 * it; the AWS SDK does. So the shape IS the fence, and it is pinned to a
 * canonical Amazon SQS queue URL.
 */
function assertValidSqsDestination(sqs: SqsDestinationInput): void {
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

  const hasKeyId = Boolean(sqs.accessKeyId);
  const hasSecret = Boolean(sqs.secretAccessKey);
  if (hasKeyId !== hasSecret) {
    throw new WebhookEndpointValidationError(
      "sqs.access_key_id and sqs.secret_access_key are set together or not at all",
    );
  }

  const mode = sqsCredentialMode({
    roleArn: sqs.roleArn,
    accessKeyId: sqs.accessKeyId,
  });
  if (mode === "ambient" && !allowsAmbientAwsCredentials()) {
    // The single most important control here. Without credentials of its
    // own, a queue endpoint writes with the deployment's identity, which can
    // reach every queue that identity can reach, including other tenants'.
    throw new WebhookEndpointValidationError(
      "sqs needs credentials of its own: either sqs.role_arn for a role to assume, or sqs.access_key_id with sqs.secret_access_key",
    );
  }
}

/** The stored destination columns, all of them, so a write always states
 *  every one and no stale field survives from another kind. */
interface StoredDestination {
  url: string | null;
  sqsQueueUrl: string | null;
  sqsRoleArn: string | null;
  sqsExternalId: string | null;
  sqsAccessKeyId: string | null;
  sqsSecretAccessKeyEncrypted: string | null;
}

const EMPTY_DESTINATION: StoredDestination = {
  url: null,
  sqsQueueUrl: null,
  sqsRoleArn: null,
  sqsExternalId: null,
  sqsAccessKeyId: null,
  sqsSecretAccessKeyEncrypted: null,
};

/**
 * The ExternalId a customer pastes into their role's trust policy.
 *
 * We generate it rather than letting the customer choose, because its whole
 * job is to be unguessable by anyone who learned the role's ARN. It is not a
 * secret of ours: it is worthless without the role that names it.
 */
function newExternalId(): string {
  return `lw-${randomBytes(16).toString("hex")}`;
}

/** Validate the destination as asked for and render it as stored columns. */
function assertValidDestination(params: {
  destinationKind: WebhookDestinationKind;
  url?: string;
  sqs?: SqsDestinationInput;
}): StoredDestination {
  if (params.destinationKind === "http") {
    if (!params.url) {
      throw new WebhookEndpointValidationError(
        "url is required for an http endpoint",
      );
    }
    if (params.sqs) {
      throw new WebhookEndpointValidationError(
        "sqs does not apply to an http endpoint",
      );
    }
    assertValidUrl(params.url);
    return { ...EMPTY_DESTINATION, url: params.url };
  }

  if (!params.sqs?.queueUrl) {
    throw new WebhookEndpointValidationError(
      "sqs.queue_url is required for an sqs endpoint",
    );
  }
  if (params.url) {
    throw new WebhookEndpointValidationError(
      "url does not apply to an sqs endpoint; name the queue in sqs.queue_url",
    );
  }
  assertValidSqsDestination(params.sqs);
  return storedSqsDestination(params.sqs);
}

function storedSqsDestination(sqs: SqsDestinationInput): StoredDestination {
  return {
    ...EMPTY_DESTINATION,
    sqsQueueUrl: sqs.queueUrl.trim(),
    sqsRoleArn: sqs.roleArn ?? null,
    // Minted here when a role is named and none was supplied: the customer
    // needs a value to put in their trust policy, and asking them to invent
    // one invites a guessable one.
    sqsExternalId: sqs.roleArn ? (sqs.externalId ?? newExternalId()) : null,
    sqsAccessKeyId: sqs.accessKeyId ?? null,
    sqsSecretAccessKeyEncrypted: sqs.secretAccessKey
      ? encrypt(sqs.secretAccessKey)
      : null,
  };
}

/**
 * An update may adjust the destination it has, never swap it for another.
 *
 * Batches already planned against the old transport are sitting in the outbox
 * with the old endpoint's shape. Creating a new endpoint is the move, and it
 * is also the only one that lets both run in parallel while the receiving side
 * is cut over.
 */
function assertDestinationUnchanged({
  endpoint,
  params,
}: {
  endpoint: WebhookEndpoint;
  params: {
    destinationKind?: WebhookDestinationKind;
    url?: string;
    sqs?: Partial<SqsDestinationInput>;
  };
}): void {
  if (
    params.destinationKind !== undefined &&
    params.destinationKind !== endpoint.destinationKind
  ) {
    throw new WebhookEndpointValidationError(
      `destination_kind cannot be changed after an endpoint is created; create a new endpoint for the ${params.destinationKind} destination and archive this one once it has drained`,
    );
  }
  if (params.url !== undefined && endpoint.destinationKind !== "http") {
    throw new WebhookEndpointValidationError(
      "url does not apply to this endpoint; it delivers to an Amazon SQS queue",
    );
  }
  if (params.sqs !== undefined && endpoint.destinationKind !== "sqs") {
    throw new WebhookEndpointValidationError(
      "sqs does not apply to this endpoint; it delivers over HTTPS",
    );
  }
}

/** A credential field this request actually named, as opposed to one it left
 *  out or cleared with null. */
function selects(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * What one credential field becomes: nothing when the request chose the other
 * mode, otherwise what the request named, otherwise what the row already held.
 */
function mergedCredentialField({
  isCleared,
  sent,
  stored,
}: {
  isCleared: boolean;
  sent: string | null | undefined;
  stored: string | null;
}): string | null {
  if (isCleared) return null;
  return sent !== undefined ? sent : stored;
}

/**
 * A partial queue update, validated as the whole it will become. Fields the
 * caller left out keep their stored values, so changing only the role never
 * silently drops the queue URL.
 *
 * Which credential mode the update selects is read from what THIS request
 * named, not from what the row already holds. Merging first and resolving
 * after let a stored role outrank a key pair the caller had just sent: the
 * endpoint kept assuming the role, the new key was dropped, and the API
 * answered 200. A switch either takes or is refused, never both.
 */
function assertValidSqsUpdate({
  endpoint,
  sqs,
}: {
  endpoint: WebhookEndpoint;
  sqs: Partial<SqsDestinationInput>;
}): StoredDestination {
  const selectsRole = selects(sqs.roleArn);
  const selectsStatic = selects(sqs.accessKeyId);
  if (selectsRole && selectsStatic) {
    throw new WebhookEndpointValidationError(
      "sqs.role_arn and sqs.access_key_id select different credential modes; send one of them, and null for the other",
    );
  }
  const merged: SqsDestinationInput = {
    queueUrl: sqs.queueUrl ?? endpoint.sqsQueueUrl ?? "",
    roleArn: mergedCredentialField({
      isCleared: selectsStatic,
      sent: sqs.roleArn,
      stored: endpoint.sqsRoleArn,
    }),
    externalId: mergedCredentialField({
      isCleared: selectsStatic,
      sent: sqs.externalId,
      stored: endpoint.sqsExternalId,
    }),
    accessKeyId: mergedCredentialField({
      isCleared: selectsRole,
      sent: sqs.accessKeyId,
      stored: endpoint.sqsAccessKeyId,
    }),
    secretAccessKey: mergedCredentialField({
      isCleared: selectsRole,
      sent: sqs.secretAccessKey,
      // The stored secret is only ever compared for presence here; its value
      // never leaves the row except at dispatch.
      stored: endpoint.sqsSecretAccessKeyEncrypted ? KEPT_SECRET : null,
    }),
  };
  // One mode at a time. Adding a role to an endpoint that had static keys
  // would otherwise leave the key pair stored, unused and unreachable through
  // any read surface, while the view reports assume_role because the role
  // wins. An unused secret sitting at rest indefinitely is exactly the thing
  // a credential rotation was meant to remove.
  const exclusive = withExclusiveCredentials(merged);
  assertValidSqsDestination(exclusive);

  const stored = storedSqsDestination(exclusive);
  return {
    ...stored,
    // A caller that did not send a new secret keeps the encrypted one it
    // already had, rather than re-encrypting the placeholder that stood in
    // for it during validation.
    sqsSecretAccessKeyEncrypted:
      exclusive.secretAccessKey === KEPT_SECRET
        ? endpoint.sqsSecretAccessKeyEncrypted
        : stored.sqsSecretAccessKeyEncrypted,
  };
}

/**
 * The credentials of the mode this destination actually selected, and none
 * of the other mode's.
 *
 * `sqsCredentialMode` resolves a role over a key pair, so the role winning is
 * what makes the key pair dead weight rather than a second way in. Clearing it
 * here means the row says what the read view says.
 */
function withExclusiveCredentials(
  sqs: SqsDestinationInput,
): SqsDestinationInput {
  if (sqs.roleArn) {
    return { ...sqs, accessKeyId: null, secretAccessKey: null };
  }
  if (sqs.accessKeyId) {
    return { ...sqs, roleArn: null, externalId: null };
  }
  return {
    ...sqs,
    roleArn: null,
    externalId: null,
    accessKeyId: null,
    secretAccessKey: null,
  };
}

/** Stands in for a stored secret the caller did not resend, so the
 *  all-or-nothing credential-pair rule is judged on the shape the endpoint
 *  will actually have. */
const KEPT_SECRET = "__langwatch_kept_secret__";

function assertValidEvents(enabledEvents: string[]): void {
  if (enabledEvents.length === 0) {
    throw new WebhookEndpointValidationError(
      "enabled_events must select at least one event type",
    );
  }
  for (const selector of enabledEvents) {
    if (!isValidEventSelector(selector)) {
      throw new WebhookEndpointValidationError(
        `unknown event selector "${selector}"`,
      );
    }
  }
}

function newSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export interface WebhookEndpointDeps {
  prisma: PrismaClient;
  /**
   * The delivery outbox, for the one thing endpoint lifecycle owes it:
   * reviving batches that retired while the endpoint was disabled. Narrowed
   * to the single method so the CRUD service never grows into a second
   * delivery engine.
   */
  processStore: Pick<ProcessStore, "requeueDeadMessages">;
  /**
   * Called when the 72h streak flips an endpoint to DISABLED. The transport
   * (email, in-app) is the caller's; the service guarantees the call fires
   * exactly once per auto-disable transition.
   */
  notifyAutoDisabled?: (params: {
    organizationId: string;
    endpointId: string;
    /** Where it was delivering, in words: the receiver URL, or the queue. */
    destination: string;
    failingSince: Date;
  }) => Promise<void>;
}

/**
 * Org-anchored webhook endpoint lifecycle: CRUD with registry-validated
 * subscriptions, the encrypted signing secret (returned in plaintext
 * exactly once, at create or roll), reversible enable/disable, and the
 * failure-streak bookkeeping behind the 72-hour auto-disable.
 */
export class WebhookEndpointService {
  constructor(private readonly deps: WebhookEndpointDeps) {}

  async create(params: {
    organizationId: string;
    /** Defaults to the transport every endpoint used before there was more
     *  than one, so an unchanged caller keeps creating HTTPS endpoints. */
    destinationKind?: WebhookDestinationKind;
    url?: string;
    sqs?: SqsDestinationInput;
    enabledEvents: string[];
    maxBatchSize?: number;
    maxBatchDelayMs?: number;
    maxInFlight?: number;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    const destinationKind = params.destinationKind ?? "http";
    const destination = assertValidDestination({ ...params, destinationKind });
    assertValidEvents(params.enabledEvents);
    assertValidDeliveryControls(params);
    const secret = newSecret();
    const endpoint = await this.deps.prisma.webhookEndpoint.create({
      data: {
        id: generate(KSUID_RESOURCES.WEBHOOK_ENDPOINT).toString(),
        organizationId: params.organizationId,
        destinationKind,
        ...destination,
        enabledEvents: params.enabledEvents,
        secretEncrypted: encrypt(secret),
        ...(params.maxBatchSize !== undefined
          ? { maxBatchSize: params.maxBatchSize }
          : {}),
        ...(params.maxBatchDelayMs !== undefined
          ? { maxBatchDelayMs: params.maxBatchDelayMs }
          : {}),
        ...(params.maxInFlight !== undefined
          ? { maxInFlight: params.maxInFlight }
          : {}),
      },
    });
    return { endpoint: toView(endpoint), secret };
  }

  async getAll(params: {
    organizationId: string;
  }): Promise<WebhookEndpointView[]> {
    const endpoints = await this.deps.prisma.webhookEndpoint.findMany({
      where: { organizationId: params.organizationId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return endpoints.map(toView);
  }

  async getById(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    return toView(await this.requireEndpoint(params));
  }

  async update(params: {
    organizationId: string;
    endpointId: string;
    /** Only ever the kind the endpoint already has. Present so a caller that
     *  echoes back the whole endpoint is not rejected for saying what is
     *  already true. */
    destinationKind?: WebhookDestinationKind;
    url?: string;
    sqs?: Partial<SqsDestinationInput>;
    enabledEvents?: string[];
    maxBatchSize?: number;
    maxBatchDelayMs?: number;
    maxInFlight?: number;
  }): Promise<WebhookEndpointView> {
    const endpoint = await this.requireEndpoint(params);
    assertDestinationUnchanged({ endpoint, params });
    if (params.url !== undefined) assertValidUrl(params.url);
    const sqsUpdate =
      params.sqs !== undefined
        ? assertValidSqsUpdate({ endpoint, sqs: params.sqs })
        : {};
    if (params.enabledEvents !== undefined)
      assertValidEvents(params.enabledEvents);
    assertValidDeliveryControls(params);
    const updated = await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        ...sqsUpdate,
        ...(params.url !== undefined ? { url: params.url } : {}),
        ...(params.enabledEvents !== undefined
          ? { enabledEvents: params.enabledEvents }
          : {}),
        ...(params.maxBatchSize !== undefined
          ? { maxBatchSize: params.maxBatchSize }
          : {}),
        ...(params.maxBatchDelayMs !== undefined
          ? { maxBatchDelayMs: params.maxBatchDelayMs }
          : {}),
        ...(params.maxInFlight !== undefined
          ? { maxInFlight: params.maxInFlight }
          : {}),
      },
    });
    return toView(updated);
  }

  /**
   * Roll the signing secret; the new value is returned exactly once.
   *
   * The outgoing secret is KEPT for {@link WEBHOOK_PREVIOUS_SECRET_TTL_MS} and
   * deliveries carry a signature from each, so a receiver swaps on its own
   * schedule. Overwriting in place made every roll a coordinated deploy: the
   * receiver rejected everything signed with the new secret until it shipped
   * the new value, and the endpoint auto-disables after 72h of failures.
   *
   * A roll inside an open window discards the secret already rolled off
   * rather than chaining a third: two valid secrets is the whole point, and
   * an operator rolling twice under suspicion of a leak means the oldest to
   * stop working immediately.
   */
  async rollSecret(params: {
    organizationId: string;
    endpointId: string;
    now?: Date;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    const endpoint = await this.requireEndpoint(params);
    const secret = newSecret();
    const now = params.now ?? new Date();
    const updated = await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        secretEncrypted: encrypt(secret),
        previousSecretEncrypted: endpoint.secretEncrypted,
        previousSecretExpiresAt: new Date(
          now.getTime() + WEBHOOK_PREVIOUS_SECRET_TTL_MS,
        ),
      },
    });
    return { endpoint: toView(updated), secret };
  }

  /**
   * Re-enable a disabled endpoint. Clears the failure streak so the 72h
   * clock restarts from the next failure, not from history.
   *
   * Batches that were already minted before the disable stayed queued while
   * it lasted — a paused batch retries until the ladder runs out, then parks
   * as dead — so re-enabling revives the parked ones with a fresh attempt
   * budget and lets the pending ones flow on their next attempt. Nothing the
   * customer queued is lost to the pause. Events that arrived DURING the
   * disable were never appended (a disabled endpoint subscribes to nothing);
   * the replay surface covers that window.
   */
  async enable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    const endpoint = await this.requireEndpoint(params);
    const updated = await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        status: "ACTIVE",
        disabledReason: null,
        disabledAt: null,
        failingSince: null,
      },
    });
    const ref = endpointStreamRef(params);
    const revived = await this.deps.processStore.requeueDeadMessages({
      ...ref,
      messageKeyPrefix: "send:",
      now: Date.now(),
    });
    if (revived > 0) {
      logger.info(
        { endpointId: params.endpointId, revived },
        "webhook endpoint re-enabled; parked batches requeued",
      );
    }
    return toView(updated);
  }

  async disable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    const endpoint = await this.requireEndpoint(params);
    const updated = await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        status: "DISABLED",
        disabledReason: WEBHOOK_DISABLED_REASON_MANUAL,
        disabledAt: new Date(),
      },
    });
    return toView(updated);
  }

  /** Soft-delete; deliveries cascade on hard delete only. */
  async archive(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<void> {
    const endpoint = await this.requireEndpoint(params);
    await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { archivedAt: new Date(), status: "DISABLED" },
    });
  }

  /**
   * The delivery executor's endpoint read: the endpoint when it is
   * deliverable (ACTIVE, not archived, owned by the org), else null. The
   * liveness predicate lives here and only here.
   */
  async getDeliverable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null> {
    const endpoint = await this.deps.prisma.webhookEndpoint.findFirst({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        status: "ACTIVE",
        archivedAt: null,
      },
    });
    return endpoint ? toView(endpoint) : null;
  }

  /**
   * Whether a frozen batch may ship, and when it may not, WHY.
   *
   * `getDeliverable` answers one question with a null that covers two very
   * different situations, and a caller holding undelivered events has to tell
   * them apart. An endpoint the customer deleted is gone, and the events they
   * asked us to stop sending go with it. An endpoint that is merely disabled —
   * including one our own auto-disable turned off after a failing streak — is
   * a receiver that is expected back, and dropping its queue is throwing away
   * events nobody chose to lose.
   */
  async getDeliveryDisposition(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<
    | { state: "deliverable"; endpoint: WebhookEndpointView }
    | { state: "paused" }
    | { state: "gone" }
  > {
    const endpoint = await this.deps.prisma.webhookEndpoint.findFirst({
      where: { id: params.endpointId, organizationId: params.organizationId },
    });
    if (!endpoint || endpoint.archivedAt !== null) return { state: "gone" };
    if (endpoint.status !== "ACTIVE") return { state: "paused" };
    return { state: "deliverable", endpoint: toView(endpoint) };
  }

  /**
   * The endpoint's last hop, with its secrets decrypted, ready for the
   * transport to use.
   *
   * The service owns the encryption and the delivery executor owns none of
   * it, so this is the whole of what crosses between them.
   */
  async getDestinationConfig(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDestinationConfig> {
    const endpoint = await this.requireEndpoint(params);
    if (endpoint.destinationKind === "sqs") {
      return {
        kind: "sqs",
        // The CHECK constraint guarantees an sqs row has its queue URL; the
        // fallback describes a row written around this service.
        queueUrl: endpoint.sqsQueueUrl ?? "",
        roleArn: endpoint.sqsRoleArn,
        externalId: endpoint.sqsExternalId,
        accessKeyId: endpoint.sqsAccessKeyId,
        secretAccessKey: endpoint.sqsSecretAccessKeyEncrypted
          ? decrypt(endpoint.sqsSecretAccessKeyEncrypted)
          : null,
      };
    }
    return { kind: "http", url: endpoint.url ?? "" };
  }

  /** Decrypted signing secret for the delivery path and test sends. */
  async getSigningSecret(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<string> {
    const endpoint = await this.requireEndpoint(params);
    return decrypt(endpoint.secretEncrypted);
  }

  /**
   * Every secret a delivery must be signed with, newest first.
   *
   * One entry outside a rotation window, two inside it. An expired previous
   * secret is dropped here rather than by a sweep, so the window closes on
   * the clock even if nothing else ran.
   */
  async getSigningSecrets(params: {
    organizationId: string;
    endpointId: string;
    now?: Date;
  }): Promise<string[]> {
    const endpoint = await this.requireEndpoint(params);
    const now = params.now ?? new Date();
    const previousIsValid =
      endpoint.previousSecretEncrypted !== null &&
      endpoint.previousSecretExpiresAt !== null &&
      endpoint.previousSecretExpiresAt.getTime() > now.getTime();
    return [
      decrypt(endpoint.secretEncrypted),
      ...(previousIsValid
        ? [decrypt(endpoint.previousSecretEncrypted as string)]
        : []),
    ];
  }

  /**
   * ACTIVE endpoints of the org, for the delivery scan's subscription
   * matching. Reads are frequent and small; no caching until measured.
   */
  /**
   * The endpoint-row half of the health read: status, streak, and the
   * last-outcome stamps. Includes disabled and failing endpoints, which is
   * exactly what a health surface must show.
   */
  async getStatusSnapshot(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  } | null> {
    const endpoint = await this.deps.prisma.webhookEndpoint.findFirst({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        archivedAt: null,
      },
      select: {
        status: true,
        disabledReason: true,
        failingSince: true,
        lastSuccessAt: true,
        lastFailureAt: true,
      },
    });
    return endpoint;
  }

  /**
   * Window rates from the delivery log. Counts aggregate over the WHOLE
   * window (a capped read would saturate them); only the latency sample is
   * capped, newest first, which is all a percentile needs.
   */
  async getDeliveryStats(params: {
    organizationId: string;
    endpointId: string;
    since: Date;
    sampleLimit: number;
  }): Promise<{ attempted: number; delivered: number; latencies: number[] }> {
    const where = {
      channel: "platform" as const,
      organizationId: params.organizationId,
      endpointId: params.endpointId,
      firedAt: { gt: params.since },
    };
    const [byOutcome, sample] = await Promise.all([
      this.deps.prisma.webhookEndpointDelivery.groupBy({
        by: ["outcome"],
        where,
        _count: { _all: true },
      }),
      this.deps.prisma.webhookEndpointDelivery.findMany({
        where: { ...where, latencyMs: { not: null } },
        select: { latencyMs: true },
        orderBy: { firedAt: "desc" },
        take: params.sampleLimit,
      }),
    ]);
    const attempted = byOutcome.reduce((sum, g) => sum + g._count._all, 0);
    const delivered =
      byOutcome.find((g) => g.outcome === "success")?._count._all ?? 0;
    return {
      attempted,
      delivered,
      latencies: sample
        .map((d) => d.latencyMs)
        .filter((l): l is number => l !== null),
    };
  }

  async getActiveByOrganization(params: {
    organizationId: string;
  }): Promise<WebhookEndpointView[]> {
    const endpoints = await this.deps.prisma.webhookEndpoint.findMany({
      where: {
        organizationId: params.organizationId,
        status: "ACTIVE",
        archivedAt: null,
      },
    });
    return endpoints.map(toView);
  }

  /** Organizations that have at least one ACTIVE endpoint. */
  async organizationIdsWithActiveEndpoints(): Promise<string[]> {
    // Cross-tenant by design: this is the delivery sweep's entry point, so
    // it uses the raw-SQL tenancy opt-out the guard sanctions for
    // system-owned maintenance scans.
    const rows = await this.deps.prisma.$queryRaw<
      Array<{ organizationId: string }>
    >`
      SELECT DISTINCT "organizationId"
      FROM "WebhookEndpoint"
      WHERE "status" = 'ACTIVE'::"WebhookEndpointStatus"
        AND "archivedAt" IS NULL
      -- @tenancy: webhook delivery sweep entry point (system-owned worker)
    `;
    return rows.map((r) => r.organizationId);
  }

  /**
   * Record one delivery attempt's outcome: the per-attempt log row (their
   * HTTP status, latency, truncated response) plus the failure-streak
   * transition, including the 72h auto-disable exactly once.
   */
  async recordDeliveryAttempt(params: {
    organizationId: string;
    endpointId: string;
    dispatchId: string;
    attempt: number;
    eventCount: number;
    outcome: WebhookDeliveryOutcome;
    responseStatus?: number;
    latencyMs?: number;
    error?: string;
    response?: unknown;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    // The (endpoint, org) pairing is verified before anything is written,
    // so a caller bug cannot file one tenant's delivery log under another.
    const endpoint = await this.deps.prisma.webhookEndpoint.findFirst({
      where: { id: params.endpointId, organizationId: params.organizationId },
    });
    if (!endpoint) {
      // Deleted mid-flight is normal and must not fail the attempt, but a
      // wrong pairing is a caller bug, so the discard leaves evidence.
      logger.warn(
        { endpointId: params.endpointId, dispatchId: params.dispatchId },
        "delivery attempt discarded: endpoint not found in organization",
      );
      return;
    }

    await this.deps.prisma.webhookEndpointDelivery.create({
      data: {
        channel: "platform",
        organizationId: params.organizationId,
        endpointId: params.endpointId,
        dispatchId: params.dispatchId,
        attempt: params.attempt,
        eventCount: params.eventCount,
        outcome: params.outcome,
        responseStatus: params.responseStatus ?? null,
        latencyMs: params.latencyMs ?? null,
        error: params.error ?? null,
        response:
          params.response === undefined
            ? undefined
            : (params.response as object),
        firedAt: now,
      },
    });

    if (params.outcome === "success") {
      await this.deps.prisma.webhookEndpoint.updateMany({
        where: { id: params.endpointId, organizationId: params.organizationId },
        data: { lastSuccessAt: now, failingSince: null },
      });
      return;
    }

    const failingSince = await this.openFailureStreak({
      organizationId: params.organizationId,
      endpointId: params.endpointId,
      knownFailingSince: endpoint.failingSince,
      now,
    });
    await this.autoDisableIfStreakExpired({
      organizationId: params.organizationId,
      endpoint,
      failingSince,
      now,
    });
  }

  /**
   * Open (or keep) the endpoint's failure streak and answer when it
   * started.
   *
   * A streak starts at the FIRST failure and is never restarted by a
   * concurrent one: the conditional update only writes failingSince where
   * it is currently null. If that write lost the race (read null, wrote
   * nothing), another attempt owns the start, so it is read back rather
   * than assumed.
   */
  private async openFailureStreak(params: {
    organizationId: string;
    endpointId: string;
    knownFailingSince: Date | null;
    now: Date;
  }): Promise<Date> {
    const started = await this.deps.prisma.webhookEndpoint.updateMany({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        failingSince: null,
      },
      data: { failingSince: params.now },
    });
    await this.deps.prisma.webhookEndpoint.updateMany({
      where: { id: params.endpointId, organizationId: params.organizationId },
      data: { lastFailureAt: params.now },
    });

    if (params.knownFailingSince !== null || started.count > 0) {
      return params.knownFailingSince ?? params.now;
    }
    const fresh = await this.deps.prisma.webhookEndpoint.findFirst({
      where: { id: params.endpointId, organizationId: params.organizationId },
      select: { failingSince: true },
    });
    return fresh?.failingSince ?? params.now;
  }

  /**
   * The 72h auto-disable, judged against the streak start that actually
   * persisted. The disable is a compare-and-set on status, so exactly one
   * of any concurrent failing attempts flips it, and only that one
   * notifies.
   */
  private async autoDisableIfStreakExpired(params: {
    organizationId: string;
    endpoint: Pick<
      WebhookEndpoint,
      "id" | "destinationKind" | "url" | "sqsQueueUrl"
    >;
    failingSince: Date;
    now: Date;
  }): Promise<void> {
    const { organizationId, endpoint, failingSince, now } = params;
    if (
      now.getTime() - failingSince.getTime() <
      WEBHOOK_AUTO_DISABLE_AFTER_MS
    ) {
      return;
    }
    const flipped = await this.deps.prisma.webhookEndpoint.updateMany({
      where: {
        id: endpoint.id,
        organizationId,
        status: "ACTIVE",
      },
      data: {
        status: "DISABLED",
        disabledReason: WEBHOOK_DISABLED_REASON_AUTO,
        disabledAt: now,
      },
    });
    if (flipped.count !== 1) return;

    logger.warn(
      {
        organizationId,
        endpointId: endpoint.id,
        failingSince: failingSince.toISOString(),
      },
      "webhook endpoint auto-disabled after 72h of consecutive failures",
    );
    try {
      await this.deps.notifyAutoDisabled?.({
        organizationId,
        endpointId: endpoint.id,
        destination: describeDestination(endpoint),
        failingSince,
      });
    } catch (error) {
      logger.error(
        { endpointId: endpoint.id, error },
        "webhook auto-disable notification failed",
      );
    }
  }

  async getDeliveries(params: {
    organizationId: string;
    endpointId: string;
    limit?: number;
    /** Resume after this row: the previous page's last (firedAt, id). */
    cursor?: { firedAt: Date; id: string };
  }): Promise<{
    deliveries: Array<{
      id: string;
      dispatchId: string;
      attempt: number;
      eventCount: number;
      outcome: WebhookDeliveryOutcome;
      responseStatus: number | null;
      latencyMs: number | null;
      error: string | null;
      firedAt: Date;
    }>;
    nextCursor: { firedAt: Date; id: string } | null;
  }> {
    await this.requireEndpoint(params);
    const limit = Math.min(params.limit ?? 25, 200);
    const rows = await this.deps.prisma.webhookEndpointDelivery.findMany({
      where: {
        // The log is shared with the automations channel now. Those rows carry
        // no organizationId or endpointId so they could not match anyway, but
        // saying so keeps this reader's scope in the query rather than in a
        // reader's head.
        channel: "platform",
        organizationId: params.organizationId,
        endpointId: params.endpointId,
        // Strictly after the cursor row in (firedAt desc, id desc) order,
        // so a page boundary stays stable while new attempts land above.
        ...(params.cursor
          ? {
              OR: [
                { firedAt: { lt: params.cursor.firedAt } },
                {
                  firedAt: params.cursor.firedAt,
                  id: { lt: params.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ firedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      deliveries: page.map((r) => ({
        id: r.id,
        dispatchId: r.dispatchId,
        // Nullable in the shared table because the automations channel records
        // neither; every platform row carries both, and the query above only
        // returns platform rows, so the fallbacks describe an unreachable row
        // rather than a value this reader invents.
        attempt: r.attempt ?? 1,
        eventCount: r.eventCount ?? 0,
        outcome: r.outcome,
        responseStatus: r.responseStatus,
        latencyMs: r.latencyMs,
        error: r.error,
        firedAt: r.firedAt,
      })),
      nextCursor:
        rows.length > limit && last
          ? { firedAt: last.firedAt, id: last.id }
          : null,
    };
  }

  /** The health strip: streak, last success, disabled state. */
  async health(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  }> {
    const endpoint = await this.requireEndpoint(params);
    return {
      status: endpoint.status,
      disabledReason: endpoint.disabledReason,
      failingSince: endpoint.failingSince,
      lastSuccessAt: endpoint.lastSuccessAt,
      lastFailureAt: endpoint.lastFailureAt,
    };
  }

  /** 30-day delivery-log prune; returns the deleted count. Runs the shared
   *  sweep, so it clears both channels' rows from the one table. */
  async pruneDeliveries(now: Date = new Date()): Promise<number> {
    return await pruneWebhookDeliveries({ prisma: this.deps.prisma, now });
  }

  private async requireEndpoint(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpoint> {
    const endpoint = await this.deps.prisma.webhookEndpoint.findFirst({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        archivedAt: null,
      },
    });
    if (!endpoint) throw new WebhookEndpointNotFoundError();
    return endpoint;
  }
}
