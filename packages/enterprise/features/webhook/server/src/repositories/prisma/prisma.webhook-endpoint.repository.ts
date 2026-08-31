// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import {
  WebhookEndpointNotFoundError,
  WebhookEndpointService as WebhookEndpointServiceContract,
  WebhookEndpointValidationError,
  isValidEventSelector,
  type SqsDestinationInput,
  type SqsDestinationView,
  type WebhookDeliveryControls,
  type WebhookDeliveryOutcome,
  type WebhookDestinationKind,
  type WebhookEndpointView,
} from "@langwatch/enterprise-webhook-contract";
import type { Prisma, PrismaClient, WebhookEndpoint } from "@langwatch/prisma-client/generated";
import type { WebhookIdPort } from "../../ports/webhook-id.port";
import type { WebhookSecretPort } from "../../ports/webhook-secret.port";
import {
  WebhookDestinationService,
  type WebhookDestinationConfig,
  type WebhookUrlProblemCode,
} from "../../services/webhook-destination.service";
import {
  WebhookEndpointConfiguration,
  WebhookEndpointPolicyService,
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
  WEBHOOK_DISABLED_REASON_AUTO,
  WEBHOOK_DISABLED_REASON_MANUAL,
} from "../../services/webhook-endpoint-policy.service";

const logger = createLogger("langwatch:webhooks:endpoint-service");
const WEBHOOK_PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const destinations = WebhookDestinationService.create();

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

/**
 * The queue an endpoint delivers to, as the customer supplies it.
 *
 * `secretAccessKey` arrives in the clear from the write surface and is
 * encrypted before it is stored; nothing reads it back out.
 */
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

/** Stands in for a stored secret the caller did not resend, so the
 *  all-or-nothing credential-pair rule is judged on the shape the endpoint
 *  will actually have. */
const KEPT_SECRET = "__langwatch_kept_secret__";

export interface WebhookEndpointDeps {
  /** Kept opaque at the package root so generated database types never leak. */
  prisma: unknown;
  ids: WebhookIdPort;
  secrets: WebhookSecretPort;
  configuration?: WebhookEndpointConfiguration;
  pruneDeliveries?: (now: Date) => Promise<number>;
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
export class PrismaWebhookEndpointRepository extends WebhookEndpointServiceContract {
  private readonly configuration: WebhookEndpointConfiguration;
  private readonly policy = WebhookEndpointPolicyService.create();
  private readonly prisma: PrismaClient;

  private constructor(private readonly deps: WebhookEndpointDeps) {
    super();
    this.prisma = deps.prisma as PrismaClient;
    this.configuration = deps.configuration ?? WebhookEndpointConfiguration.create();
  }

  static create(deps: WebhookEndpointDeps): PrismaWebhookEndpointRepository {
    return new PrismaWebhookEndpointRepository(deps);
  }

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
    const destination = PrismaWebhookEndpointRepository.assertValidDestination(
      { ...params, destinationKind },
      this.configuration,
      this.deps.secrets,
    );
    PrismaWebhookEndpointRepository.assertValidEvents(params.enabledEvents);
    this.policy.assertValidDeliveryControls(params);
    const secret = PrismaWebhookEndpointRepository.newSecret();
    const data: Prisma.WebhookEndpointUncheckedCreateInput = {
      id: this.deps.ids.newEndpointId(),
      organizationId: params.organizationId,
      destinationKind,
      ...destination,
      enabledEvents: params.enabledEvents,
      secretEncrypted: this.deps.secrets.encrypt(secret),
    };
    if (params.maxBatchSize !== undefined) {
      data.maxBatchSize = params.maxBatchSize;
    }
    if (params.maxBatchDelayMs !== undefined) {
      data.maxBatchDelayMs = params.maxBatchDelayMs;
    }
    if (params.maxInFlight !== undefined) {
      data.maxInFlight = params.maxInFlight;
    }
    const endpoint = await this.prisma.webhookEndpoint.create({
      data,
    });
    return { endpoint: PrismaWebhookEndpointRepository.toView(endpoint), secret };
  }

  async getAll(params: { organizationId: string }): Promise<WebhookEndpointView[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId: params.organizationId, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return endpoints.map((endpoint) => PrismaWebhookEndpointRepository.toView(endpoint));
  }

  async getById(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    return PrismaWebhookEndpointRepository.toView(await this.getEndpoint(params));
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
    const endpoint = await this.getEndpoint(params);
    PrismaWebhookEndpointRepository.assertDestinationUnchanged({ endpoint, params });
    if (params.url !== undefined)
      PrismaWebhookEndpointRepository.assertValidUrl(params.url, this.configuration);
    const sqsUpdate =
      params.sqs !== undefined
        ? PrismaWebhookEndpointRepository.assertValidSqsUpdate({
            endpoint,
            sqs: params.sqs,
            configuration: this.configuration,
            secrets: this.deps.secrets,
          })
        : {};
    if (params.enabledEvents !== undefined)
      PrismaWebhookEndpointRepository.assertValidEvents(params.enabledEvents);
    this.policy.assertValidDeliveryControls(params);
    const data: Prisma.WebhookEndpointUncheckedUpdateInput = { ...sqsUpdate };
    if (params.url !== undefined) data.url = params.url;
    if (params.enabledEvents !== undefined) {
      data.enabledEvents = params.enabledEvents;
    }
    if (params.maxBatchSize !== undefined) {
      data.maxBatchSize = params.maxBatchSize;
    }
    if (params.maxBatchDelayMs !== undefined) {
      data.maxBatchDelayMs = params.maxBatchDelayMs;
    }
    if (params.maxInFlight !== undefined) {
      data.maxInFlight = params.maxInFlight;
    }
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data,
    });
    return PrismaWebhookEndpointRepository.toView(updated);
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
    const endpoint = await this.getEndpoint(params);
    const secret = PrismaWebhookEndpointRepository.newSecret();
    const now = params.now ?? new Date();
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        secretEncrypted: this.deps.secrets.encrypt(secret),
        previousSecretEncrypted: endpoint.secretEncrypted,
        previousSecretExpiresAt: new Date(now.getTime() + WEBHOOK_PREVIOUS_SECRET_TTL_MS),
      },
    });
    return { endpoint: PrismaWebhookEndpointRepository.toView(updated), secret };
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
    const endpoint = await this.getEndpoint(params);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        status: "ACTIVE",
        disabledReason: null,
        disabledAt: null,
        failingSince: null,
      },
    });
    return PrismaWebhookEndpointRepository.toView(updated);
  }

  async disable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    const endpoint = await this.getEndpoint(params);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        status: "DISABLED",
        disabledReason: WEBHOOK_DISABLED_REASON_MANUAL,
        disabledAt: new Date(),
      },
    });
    return PrismaWebhookEndpointRepository.toView(updated);
  }

  /** Soft-delete; deliveries cascade on hard delete only. */
  async archive(params: { organizationId: string; endpointId: string }): Promise<void> {
    const endpoint = await this.getEndpoint(params);
    await this.prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { archivedAt: new Date(), status: "DISABLED" },
    });
  }

  /**
   * The delivery executor's endpoint read: the endpoint when it is
   * deliverable (ACTIVE, not archived, owned by the org), else null. The
   * liveness predicate lives here and only here.
   */
  async tryGetDeliverable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        status: "ACTIVE",
        archivedAt: null,
      },
    });
    return endpoint ? PrismaWebhookEndpointRepository.toView(endpoint) : null;
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
    const endpoint = await this.getEndpoint(params);
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
          ? this.deps.secrets.decrypt(endpoint.sqsSecretAccessKeyEncrypted)
          : null,
      };
    }
    return { kind: "http", url: endpoint.url ?? "" };
  }

  /** Decrypted signing secret for the delivery path and test sends. */
  async getSigningSecret(params: { organizationId: string; endpointId: string }): Promise<string> {
    const endpoint = await this.getEndpoint(params);
    return this.deps.secrets.decrypt(endpoint.secretEncrypted);
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
    const endpoint = await this.getEndpoint(params);
    const now = params.now ?? new Date();
    const previousIsValid =
      endpoint.previousSecretEncrypted !== null &&
      endpoint.previousSecretExpiresAt !== null &&
      endpoint.previousSecretExpiresAt.getTime() > now.getTime();
    const secrets = [this.deps.secrets.decrypt(endpoint.secretEncrypted)];
    if (previousIsValid) {
      secrets.push(this.deps.secrets.decrypt(endpoint.previousSecretEncrypted as string));
    }
    return secrets;
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
  async tryGetStatusSnapshot(params: { organizationId: string; endpointId: string }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  } | null> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
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
      this.prisma.webhookEndpointDelivery.groupBy({
        by: ["outcome"],
        where,
        _count: { _all: true },
      }),
      this.prisma.webhookEndpointDelivery.findMany({
        where: { ...where, latencyMs: { not: null } },
        select: { latencyMs: true },
        orderBy: { firedAt: "desc" },
        take: params.sampleLimit,
      }),
    ]);
    const attempted = byOutcome.reduce((sum, g) => sum + g._count._all, 0);
    const delivered = byOutcome.find((g) => g.outcome === "success")?._count._all ?? 0;
    return {
      attempted,
      delivered,
      latencies: sample.map((d) => d.latencyMs).filter((l): l is number => l !== null),
    };
  }

  async getActiveByOrganization(params: {
    organizationId: string;
  }): Promise<WebhookEndpointView[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        organizationId: params.organizationId,
        status: "ACTIVE",
        archivedAt: null,
      },
    });
    return endpoints.map((endpoint) => PrismaWebhookEndpointRepository.toView(endpoint));
  }

  /** Organizations that have at least one ACTIVE endpoint. */
  async organizationIdsWithActiveEndpoints(): Promise<string[]> {
    // Cross-tenant by design: this is the delivery sweep's entry point, so
    // it uses the raw-SQL tenancy opt-out the guard sanctions for
    // system-owned maintenance scans.
    const rows = await this.prisma.$queryRaw<Array<{ organizationId: string }>>`
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
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
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

    await this.prisma.webhookEndpointDelivery.create({
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
        response: params.response === undefined ? undefined : (params.response as object),
        firedAt: now,
      },
    });

    if (params.outcome === "success") {
      await this.prisma.webhookEndpoint.updateMany({
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
    const started = await this.prisma.webhookEndpoint.updateMany({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        failingSince: null,
      },
      data: { failingSince: params.now },
    });
    await this.prisma.webhookEndpoint.updateMany({
      where: { id: params.endpointId, organizationId: params.organizationId },
      data: { lastFailureAt: params.now },
    });

    if (params.knownFailingSince !== null || started.count > 0) {
      return params.knownFailingSince ?? params.now;
    }
    const fresh = await this.prisma.webhookEndpoint.findFirst({
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
    endpoint: Pick<WebhookEndpoint, "id" | "destinationKind" | "url" | "sqsQueueUrl">;
    failingSince: Date;
    now: Date;
  }): Promise<void> {
    const { organizationId, endpoint, failingSince, now } = params;
    if (now.getTime() - failingSince.getTime() < WEBHOOK_AUTO_DISABLE_AFTER_MS) {
      return;
    }
    const flipped = await this.prisma.webhookEndpoint.updateMany({
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
        destination: this.policy.describeDestination(endpoint),
        failingSince,
      });
    } catch (error) {
      logger.error({ endpointId: endpoint.id, error }, "webhook auto-disable notification failed");
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
    await this.getEndpoint(params);
    const limit = Math.min(params.limit ?? 25, 200);
    const where: Prisma.WebhookEndpointDeliveryWhereInput = {
      // The log is shared with the automations channel now. Those rows carry
      // no organizationId or endpointId so they could not match anyway, but
      // saying so keeps this reader's scope in the query rather than in a
      // reader's head.
      channel: "platform",
      organizationId: params.organizationId,
      endpointId: params.endpointId,
      // Strictly after the cursor row in (firedAt desc, id desc) order,
      // so a page boundary stays stable while new attempts land above.
    };
    if (params.cursor) {
      where.OR = [
        { firedAt: { lt: params.cursor.firedAt } },
        {
          firedAt: params.cursor.firedAt,
          id: { lt: params.cursor.id },
        },
      ];
    }
    const rows = await this.prisma.webhookEndpointDelivery.findMany({
      where,
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
        outcome: r.outcome as "success" | "retryable" | "terminal",
        responseStatus: r.responseStatus,
        latencyMs: r.latencyMs,
        error: r.error,
        firedAt: r.firedAt,
      })),
      nextCursor: rows.length > limit && last ? { firedAt: last.firedAt, id: last.id } : null,
    };
  }

  /** The health strip: streak, last success, disabled state. */
  async health(params: { organizationId: string; endpointId: string }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  }> {
    const endpoint = await this.getEndpoint(params);
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
    if (this.deps.pruneDeliveries) {
      return await this.deps.pruneDeliveries(now);
    }
    const result = await this.prisma.webhookEndpointDelivery.deleteMany({
      where: {
        firedAt: {
          lt: new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS),
        },
      },
    });
    return result.count;
  }

  private async getEndpoint(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        archivedAt: null,
      },
    });
    if (!endpoint) throw new WebhookEndpointNotFoundError();
    return endpoint;
  }

  private static toView(endpoint: WebhookEndpoint): WebhookEndpointView {
    return {
      id: endpoint.id,
      organizationId: endpoint.organizationId,
      destinationKind: endpoint.destinationKind,
      url: endpoint.url,
      sqs: PrismaWebhookEndpointRepository.toSqsView(endpoint),
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

  private static assertValidUrl(url: string, configuration: WebhookEndpointConfiguration): void {
    // Same policy the sender enforces at dispatch, so an endpoint that saves is
    // an endpoint that can deliver. Operator opt-in for local development and
    // internal receivers relaxes the origin here exactly as it relaxes the
    // local-address fence on the send.
    const problem = destinations.tryInspectUrl(url, configuration.allowInsecureLocalUrls);
    if (problem) {
      throw new WebhookEndpointValidationError(URL_PROBLEM_MESSAGES[problem]);
    }
  }

  /** Where an endpoint delivers, in one line, for a log or a notification. */
  private static toSqsView(endpoint: WebhookEndpoint): SqsDestinationView | null {
    if (endpoint.destinationKind !== "sqs" || !endpoint.sqsQueueUrl) return null;
    const parsed = destinations.tryParseSqsQueueUrl(endpoint.sqsQueueUrl);
    return {
      queueUrl: endpoint.sqsQueueUrl,
      // Every stored queue URL passed admission, so the parse succeeds. The
      // fallbacks describe a row written around the service rather than a
      // value invented here.
      region: parsed?.region ?? "",
      accountId: parsed?.accountId ?? "",
      queueName: parsed?.queueName ?? "",
      credentialMode: destinations.sqsCredentialMode({
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
  private static assertValidSqsDestination(
    sqs: SqsDestinationInput,
    configuration: WebhookEndpointConfiguration,
  ): void {
    const inspection = destinations.inspectSqsQueueUrl(sqs.queueUrl);
    if (!inspection.ok) {
      throw new WebhookEndpointValidationError(
        inspection.problem === "fifo"
          ? "sqs.queue_url must name a standard queue; FIFO queues are not supported. Deliveries are at-least-once and deduplicated on the envelope id, which is what a standard queue provides."
          : "sqs.queue_url must be an Amazon SQS queue URL, like https://sqs.<region>.amazonaws.com/<account id>/<queue name>",
      );
    }

    if (sqs.roleArn && !destinations.isRoleArn(sqs.roleArn)) {
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

    const mode = destinations.sqsCredentialMode({
      roleArn: sqs.roleArn,
      accessKeyId: sqs.accessKeyId,
    });
    if (mode === "ambient" && !configuration.allowAmbientAwsCredentials) {
      // The single most important control here. Without credentials of its
      // own, a queue endpoint writes with the deployment's identity, which can
      // reach every queue that identity can reach, including other tenants'.
      throw new WebhookEndpointValidationError(
        "sqs needs credentials of its own: either sqs.role_arn for a role to assume, or sqs.access_key_id with sqs.secret_access_key",
      );
    }
  }

  /**
   * The ExternalId a customer pastes into their role's trust policy.
   *
   * We generate it rather than letting the customer choose, because its whole
   * job is to be unguessable by anyone who learned the role's ARN. It is not a
   * secret of ours: it is worthless without the role that names it.
   */
  private static newExternalId(): string {
    return `lw-${randomBytes(16).toString("hex")}`;
  }

  /** Validate the destination as asked for and render it as stored columns. */
  private static assertValidDestination(
    params: {
      destinationKind: WebhookDestinationKind;
      url?: string;
      sqs?: SqsDestinationInput;
    },
    configuration: WebhookEndpointConfiguration,
    secrets: WebhookSecretPort,
  ): StoredDestination {
    if (params.destinationKind === "http") {
      if (!params.url) {
        throw new WebhookEndpointValidationError("url is required for an http endpoint");
      }
      if (params.sqs) {
        throw new WebhookEndpointValidationError("sqs does not apply to an http endpoint");
      }
      PrismaWebhookEndpointRepository.assertValidUrl(params.url, configuration);
      return { ...EMPTY_DESTINATION, url: params.url };
    }

    if (!params.sqs?.queueUrl) {
      throw new WebhookEndpointValidationError("sqs.queue_url is required for an sqs endpoint");
    }
    if (params.url) {
      throw new WebhookEndpointValidationError(
        "url does not apply to an sqs endpoint; name the queue in sqs.queue_url",
      );
    }
    PrismaWebhookEndpointRepository.assertValidSqsDestination(params.sqs, configuration);
    return PrismaWebhookEndpointRepository.storedSqsDestination(params.sqs, secrets);
  }

  private static storedSqsDestination(
    sqs: SqsDestinationInput,
    secrets: WebhookSecretPort,
  ): StoredDestination {
    return {
      ...EMPTY_DESTINATION,
      sqsQueueUrl: sqs.queueUrl.trim(),
      sqsRoleArn: sqs.roleArn ?? null,
      // Minted here when a role is named and none was supplied: the customer
      // needs a value to put in their trust policy, and asking them to invent
      // one invites a guessable one.
      sqsExternalId: sqs.roleArn
        ? (sqs.externalId ?? PrismaWebhookEndpointRepository.newExternalId())
        : null,
      sqsAccessKeyId: sqs.accessKeyId ?? null,
      sqsSecretAccessKeyEncrypted: sqs.secretAccessKey
        ? secrets.encrypt(sqs.secretAccessKey)
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
  private static assertDestinationUnchanged({
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
  private static selects(value: string | null | undefined): boolean {
    return typeof value === "string" && value.trim() !== "";
  }

  /**
   * What one credential field becomes: nothing when the request chose the other
   * mode, otherwise what the request named, otherwise what the row already held.
   */
  private static mergedCredentialField({
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
  private static assertValidSqsUpdate({
    endpoint,
    sqs,
    configuration,
    secrets,
  }: {
    endpoint: WebhookEndpoint;
    sqs: Partial<SqsDestinationInput>;
    configuration: WebhookEndpointConfiguration;
    secrets: WebhookSecretPort;
  }): StoredDestination {
    const selectsRole = PrismaWebhookEndpointRepository.selects(sqs.roleArn);
    const selectsStatic = PrismaWebhookEndpointRepository.selects(sqs.accessKeyId);
    if (selectsRole && selectsStatic) {
      throw new WebhookEndpointValidationError(
        "sqs.role_arn and sqs.access_key_id select different credential modes; send one of them, and null for the other",
      );
    }
    const merged: SqsDestinationInput = {
      queueUrl: sqs.queueUrl ?? endpoint.sqsQueueUrl ?? "",
      roleArn: PrismaWebhookEndpointRepository.mergedCredentialField({
        isCleared: selectsStatic,
        sent: sqs.roleArn,
        stored: endpoint.sqsRoleArn,
      }),
      externalId: PrismaWebhookEndpointRepository.mergedCredentialField({
        isCleared: selectsStatic,
        sent: sqs.externalId,
        stored: endpoint.sqsExternalId,
      }),
      accessKeyId: PrismaWebhookEndpointRepository.mergedCredentialField({
        isCleared: selectsRole,
        sent: sqs.accessKeyId,
        stored: endpoint.sqsAccessKeyId,
      }),
      secretAccessKey: PrismaWebhookEndpointRepository.mergedCredentialField({
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
    const exclusive = PrismaWebhookEndpointRepository.withExclusiveCredentials(merged);
    PrismaWebhookEndpointRepository.assertValidSqsDestination(exclusive, configuration);

    const stored = PrismaWebhookEndpointRepository.storedSqsDestination(exclusive, secrets);
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
  private static withExclusiveCredentials(sqs: SqsDestinationInput): SqsDestinationInput {
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

  private static assertValidEvents(enabledEvents: string[]): void {
    if (enabledEvents.length === 0) {
      throw new WebhookEndpointValidationError(
        "enabled_events must select at least one event type",
      );
    }
    for (const selector of enabledEvents) {
      if (!isValidEventSelector(selector)) {
        throw new WebhookEndpointValidationError(`unknown event selector "${selector}"`);
      }
    }
  }

  private static newSecret(): string {
    return `whsec_${randomBytes(32).toString("base64url")}`;
  }
}
