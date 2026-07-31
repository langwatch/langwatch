// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type {
  PrismaClient,
  WebhookDeliveryOutcome,
  WebhookEndpoint,
} from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { decrypt, encrypt } from "~/utils/encryption";
import { isValidEventSelector } from "./eventRegistry";

const logger = createLogger("langwatch:webhooks:endpoint-service");

/** 72 hours of unbroken failures auto-disables an endpoint. */
export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 72 * 60 * 60 * 1000;
/** Delivery-log retention, mirroring the automations webhook log. */
export const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

export class WebhookEndpointValidationError extends Error {}
export class WebhookEndpointNotFoundError extends Error {
  constructor() {
    super("Webhook endpoint not found");
  }
}

export interface WebhookEndpointView {
  id: string;
  organizationId: string;
  url: string;
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
    url: endpoint.url,
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

function assertValidUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookEndpointValidationError("url must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new WebhookEndpointValidationError("url must use https");
  }
}

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
   * Called when the 72h streak flips an endpoint to DISABLED. The transport
   * (email, in-app) is the caller's; the service guarantees the call fires
   * exactly once per auto-disable transition.
   */
  notifyAutoDisabled?: (params: {
    organizationId: string;
    endpointId: string;
    url: string;
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
    url: string;
    enabledEvents: string[];
    maxBatchSize?: number;
    maxBatchDelayMs?: number;
    maxInFlight?: number;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    assertValidUrl(params.url);
    assertValidEvents(params.enabledEvents);
    assertValidDeliveryControls(params);
    const secret = newSecret();
    const endpoint = await this.deps.prisma.webhookEndpoint.create({
      data: {
        id: generate(KSUID_RESOURCES.WEBHOOK_ENDPOINT).toString(),
        organizationId: params.organizationId,
        url: params.url,
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
    url?: string;
    enabledEvents?: string[];
    maxBatchSize?: number;
    maxBatchDelayMs?: number;
    maxInFlight?: number;
  }): Promise<WebhookEndpointView> {
    const endpoint = await this.requireEndpoint(params);
    if (params.url !== undefined) assertValidUrl(params.url);
    if (params.enabledEvents !== undefined)
      assertValidEvents(params.enabledEvents);
    assertValidDeliveryControls(params);
    const updated = await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
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

  /** Roll the signing secret; the new value is returned exactly once. */
  async rollSecret(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    const endpoint = await this.requireEndpoint(params);
    const secret = newSecret();
    const updated = await this.deps.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { secretEncrypted: encrypt(secret) },
    });
    return { endpoint: toView(updated), secret };
  }

  /**
   * Re-enable a disabled endpoint. Clears the failure streak so the 72h
   * clock restarts from the next failure, not from history. Events that
   * accrued while disabled are NOT re-sent automatically; the replay
   * surface covers the gap window.
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

  /** Decrypted signing secret for the delivery path and test sends. */
  async getSigningSecret(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<string> {
    const endpoint = await this.requireEndpoint(params);
    return decrypt(endpoint.secretEncrypted);
  }

  /**
   * ACTIVE endpoints of the org, for the delivery scan's subscription
   * matching. Reads are frequent and small; no caching until measured.
   */
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
    if (!endpoint) return;

    await this.deps.prisma.webhookEndpointDelivery.create({
      data: {
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

    // A streak starts at the FIRST failure and is never restarted by a
    // concurrent one: the conditional update only writes failingSince where
    // it is currently null.
    await this.deps.prisma.webhookEndpoint.updateMany({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        failingSince: null,
      },
      data: { failingSince: now },
    });
    await this.deps.prisma.webhookEndpoint.updateMany({
      where: { id: params.endpointId, organizationId: params.organizationId },
      data: { lastFailureAt: now },
    });

    const failingSince = endpoint.failingSince ?? now;
    if (now.getTime() - failingSince.getTime() < WEBHOOK_AUTO_DISABLE_AFTER_MS) {
      return;
    }
    // The disable is a compare-and-set on status, so exactly one of any
    // concurrent failing attempts flips it, and only that one notifies.
    const flipped = await this.deps.prisma.webhookEndpoint.updateMany({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
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
        organizationId: params.organizationId,
        endpointId: params.endpointId,
        failingSince: failingSince.toISOString(),
      },
      "webhook endpoint auto-disabled after 72h of consecutive failures",
    );
    try {
      await this.deps.notifyAutoDisabled?.({
        organizationId: params.organizationId,
        endpointId: params.endpointId,
        url: endpoint.url,
        failingSince,
      });
    } catch (error) {
      logger.error(
        { endpointId: params.endpointId, error },
        "webhook auto-disable notification failed",
      );
    }
  }

  async getDeliveries(params: {
    organizationId: string;
    endpointId: string;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      dispatchId: string;
      attempt: number;
      eventCount: number;
      outcome: WebhookDeliveryOutcome;
      responseStatus: number | null;
      latencyMs: number | null;
      error: string | null;
      firedAt: Date;
    }>
  > {
    await this.requireEndpoint(params);
    const rows = await this.deps.prisma.webhookEndpointDelivery.findMany({
      where: {
        organizationId: params.organizationId,
        endpointId: params.endpointId,
      },
      orderBy: { firedAt: "desc" },
      take: Math.min(params.limit ?? 50, 200),
    });
    return rows.map((r) => ({
      id: r.id,
      dispatchId: r.dispatchId,
      attempt: r.attempt,
      eventCount: r.eventCount,
      outcome: r.outcome,
      responseStatus: r.responseStatus,
      latencyMs: r.latencyMs,
      error: r.error,
      firedAt: r.firedAt,
    }));
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

  /** 30-day delivery-log prune; returns the deleted count. */
  async pruneDeliveries(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS);
    const deleted = await this.deps.prisma.$executeRaw`
      DELETE FROM "WebhookEndpointDelivery"
      WHERE "firedAt" < ${before}
      -- @tenancy: webhook delivery-log retention sweep (system-owned maintenance)
    `;
    return deleted;
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
