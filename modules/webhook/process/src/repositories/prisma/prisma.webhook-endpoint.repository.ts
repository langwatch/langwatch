import { randomBytes } from "node:crypto";
// SPDX-License-Identifier: Apache-2.0

import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient, WebhookEndpoint } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";
import {
  WebhookEndpointNotFoundError,
  type SqsDestinationInput,
  type SqsDestinationView,
  type WebhookDeliveryOutcome,
  type WebhookDestinationKind,
  type WebhookEndpointView,
  webhookRequestFailureResponseSchema,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
} from "@langwatch/webhook-contract";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { parseSqsQueueUrl } from "../../rules/sqs-queue-url.rules.ts";
import type { WebhookDeliveryDisposition } from "../../rules/webhook-delivery-contract.rules.ts";
import {
  describeDestination,
  sqsCredentialMode,
  type WebhookDestinationConfig,
} from "../../rules/webhook-destination.rules.ts";
import {
  mergeSqsUpdate,
  webhookEndpointConfiguration,
  type WebhookEndpointConfiguration,
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
  WEBHOOK_DISABLED_REASON_AUTO,
  WEBHOOK_DISABLED_REASON_MANUAL,
  WEBHOOK_KEPT_SECRET,
} from "../../rules/webhook-endpoint-policy.rules.ts";
import type {
  WebhookEndpointRepository,
  WebhookRequestAttempt,
  WebhookRequestAttemptRow,
} from "../webhook-endpoint.repository.ts";
import { PrismaWebhookRetentionRepository } from "./prisma.webhook-retention.repository.ts";

/** A stored failure response; an unreadable one reads as absent rather than failing the list. */
const storedFailureResponseSchema = webhookRequestFailureResponseSchema.nullable().catch(null);

const logger = createLogger("langwatch:webhooks:endpoint-service");

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

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type WebhookEndpointDatabase = Pick<
  PrismaClient,
  "webhookEndpoint" | "webhookEndpointDelivery" | "$queryRaw" | "$executeRaw"
>;

/** The endpoint row's health stamps, on the one clock the seam above reads. */
function statusSnapshotOf(row: {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}): {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Instant | null;
  lastSuccessAt: Instant | null;
  lastFailureAt: Instant | null;
} {
  return {
    status: row.status,
    disabledReason: row.disabledReason,
    failingSince: row.failingSince === null ? null : fromDate(row.failingSince),
    lastSuccessAt: row.lastSuccessAt === null ? null : fromDate(row.lastSuccessAt),
    lastFailureAt: row.lastFailureAt === null ? null : fromDate(row.lastFailureAt),
  };
}

interface WebhookEndpointDeps {
  prisma: WebhookEndpointDatabase;
  ids: WebhookId;
  secrets: WebhookSecret;
  configuration?: WebhookEndpointConfiguration;
  pruneDeliveries?: (now: Instant) => Promise<number>;
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
    failingSince: Instant;
  }) => Promise<void>;
}

/**
 * Org-anchored webhook endpoint lifecycle: CRUD with registry-validated
 * subscriptions, the encrypted signing secret (returned in plaintext
 * exactly once, at create or roll), reversible enable/disable, and the
 * failure-streak bookkeeping behind the 72-hour auto-disable.
 */
export class PrismaWebhookEndpointRepository implements WebhookEndpointRepository {
  /**
   * Flips an ACTIVE endpoint to DISABLED for its failure streak; true for the one
   * caller that flipped it. As SQL so a write parked on the row lock re-checks the
   * committed status, which `updateMany`'s subquery does not.
   */
  static async disableForFailureStreak({
    prisma,
    organizationId,
    endpointId,
    now,
  }: {
    prisma: Pick<WebhookEndpointDatabase, "$executeRaw">;
    organizationId: string;
    endpointId: string;
    now: Date;
  }): Promise<boolean> {
    const flipped = await prisma.$executeRaw`
      UPDATE "WebhookEndpoint"
         SET "status" = 'DISABLED',
             "disabledReason" = ${WEBHOOK_DISABLED_REASON_AUTO},
             "disabledAt" = ${now},
             "updatedAt" = now()
       WHERE "id" = ${endpointId}
         AND "organizationId" = ${organizationId}
         AND "status" = 'ACTIVE'
    `;
    return flipped === 1;
  }

  static readonly tables = prismaTables("WebhookEndpoint", "WebhookEndpointDelivery");
  private readonly configuration: WebhookEndpointConfiguration;
  private readonly prisma: WebhookEndpointDatabase;

  private constructor(private readonly deps: WebhookEndpointDeps) {
    this.prisma = deps.prisma;
    this.configuration = deps.configuration ?? webhookEndpointConfiguration();
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
    const destination = PrismaWebhookEndpointRepository.storedDestination(
      params,
      this.deps.secrets,
    );
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

  async findAll(params: { organizationId: string }): Promise<WebhookEndpointView[]> {
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
    const sqsUpdate =
      params.sqs !== undefined
        ? PrismaWebhookEndpointRepository.storedSqsUpdate({
            endpoint,
            sqs: params.sqs,
            configuration: this.configuration,
            secrets: this.deps.secrets,
          })
        : {};
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
    now?: Instant;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    const endpoint = await this.getEndpoint(params);
    const secret = PrismaWebhookEndpointRepository.newSecret();
    const now = toDate(params.now ?? nowInstant());
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
  async findDeliverable(params: {
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

  async getDeliveryDisposition(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDeliveryDisposition> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: params.endpointId, organizationId: params.organizationId },
    });
    if (!endpoint || endpoint.archivedAt !== null) return { state: "gone" };
    if (endpoint.status !== "ACTIVE") return { state: "paused" };
    return { state: "deliverable", endpoint: PrismaWebhookEndpointRepository.toView(endpoint) };
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
  async findSigningSecrets(params: {
    organizationId: string;
    endpointId: string;
    now?: Instant;
  }): Promise<string[]> {
    const endpoint = await this.getEndpoint(params);
    const now = toDate(params.now ?? nowInstant());
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
  async findStatusSnapshot(params: { organizationId: string; endpointId: string }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Instant | null;
    lastSuccessAt: Instant | null;
    lastFailureAt: Instant | null;
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

    return endpoint ? statusSnapshotOf(endpoint) : null;
  }

  /**
   * Window rates from the delivery log. Counts aggregate over the WHOLE
   * window (a capped read would saturate them); only the latency sample is
   * capped, newest first, which is all a percentile needs.
   */
  async getDeliveryStats(params: {
    organizationId: string;
    endpointId: string;
    since: Instant;
    sampleLimit: number;
  }): Promise<{ attempted: number; delivered: number; latencies: number[] }> {
    const where = {
      channel: "platform" as const,
      organizationId: params.organizationId,
      endpointId: params.endpointId,
      firedAt: { gt: toDate(params.since) },
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

  async findActiveByOrganization(params: {
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
    const rows = await this.prisma.$queryRaw<{ organizationId: string }[]>`
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
    now?: Instant;
  }): Promise<void> {
    const now = toDate(params.now ?? nowInstant());
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
    const failingDurationMs = now.getTime() - failingSince.getTime();
    if (failingDurationMs < WEBHOOK_AUTO_DISABLE_AFTER_MS) {
      return;
    }
    const flipped = await PrismaWebhookEndpointRepository.disableForFailureStreak({
      prisma: this.prisma,
      organizationId,
      endpointId: endpoint.id,
      now,
    });
    if (!flipped) return;

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
        failingSince: fromDate(failingSince),
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
    cursor?: { firedAt: Instant; id: string };
  }): Promise<{
    deliveries: {
      id: string;
      dispatchId: string;
      attempt: number;
      eventCount: number;
      outcome: WebhookDeliveryOutcome;
      responseStatus: number | null;
      latencyMs: number | null;
      error: string | null;
      firedAt: Instant;
    }[];
    nextCursor: { firedAt: Instant; id: string } | null;
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
      const cursorFiredAt = toDate(params.cursor.firedAt);
      where.OR = [
        { firedAt: { lt: cursorFiredAt } },
        {
          firedAt: cursorFiredAt,
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
        firedAt: fromDate(r.firedAt),
      })),
      nextCursor:
        rows.length > limit && last ? { firedAt: fromDate(last.firedAt), id: last.id } : null,
    };
  }

  /** The health strip: streak, last success, disabled state. */
  async health(params: { organizationId: string; endpointId: string }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Instant | null;
    lastSuccessAt: Instant | null;
    lastFailureAt: Instant | null;
  }> {
    return statusSnapshotOf(await this.getEndpoint(params));
  }

  async recordRequestAttempt(attempt: WebhookRequestAttempt): Promise<void> {
    await this.prisma.webhookEndpointDelivery.create({
      data: {
        channel: "automations",
        projectId: attempt.projectId,
        triggerId: attempt.triggerId,
        dispatchId: attempt.dispatchId,
        responseStatus: attempt.responseStatus,
        latencyMs: attempt.latencyMs,
        error: attempt.error,
        response: attempt.response ?? undefined,
        outcome: attempt.outcome,
      },
    });
  }

  async findRequestAttempts(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookRequestAttemptRow[]> {
    const rows = await this.prisma.webhookEndpointDelivery.findMany({
      where: { channel: "automations", projectId: input.projectId, triggerId: input.triggerId },
      orderBy: { firedAt: "desc" },
      take: input.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: input.projectId,
      triggerId: input.triggerId,
      dispatchId: row.dispatchId,
      responseStatus: row.responseStatus,
      latencyMs: row.latencyMs,
      error: row.error,
      response: storedFailureResponseSchema.parse(row.response),
      outcome: row.outcome,
      firedAt: fromDate(row.firedAt),
    }));
  }

  /** 30-day delivery-log prune; returns the deleted count. Runs the shared
   *  sweep, so it clears both channels' rows from the one table. */
  async pruneDeliveries(now: Instant = nowInstant()): Promise<number> {
    if (this.deps.pruneDeliveries) {
      return this.deps.pruneDeliveries(now);
    }
    return PrismaWebhookRetentionRepository.create({ prisma: this.prisma }).pruneDeliveries({
      now,
    });
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

  /** Where an endpoint delivers, in one line, for a log or a notification. */
  private static toSqsView(endpoint: WebhookEndpoint): SqsDestinationView | null {
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
   * The ExternalId a customer pastes into their role's trust policy.
   *
   * We generate it rather than letting the customer choose, because its whole
   * job is to be unguessable by anyone who learned the role's ARN. It is not a
   * secret of ours: it is worthless without the role that names it.
   */
  private static newExternalId(): string {
    return `lw-${randomBytes(16).toString("hex")}`;
  }

  /** A validated destination, rendered as stored columns. */
  private static storedDestination(
    params: { url?: string; sqs?: SqsDestinationInput },
    secrets: WebhookSecret,
  ): StoredDestination {
    if (!params.sqs) return { ...EMPTY_DESTINATION, url: params.url ?? null };
    return PrismaWebhookEndpointRepository.storedSqsDestination(params.sqs, secrets);
  }

  private static storedSqsDestination(
    sqs: SqsDestinationInput,
    secrets: WebhookSecret,
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

  /** A queue update merged and validated by the rules, rendered as stored columns. A kept
   *  secret stays the encrypted one the row already had. */
  private static storedSqsUpdate({
    endpoint,
    sqs,
    configuration,
    secrets,
  }: {
    endpoint: WebhookEndpoint;
    sqs: Partial<SqsDestinationInput>;
    configuration: WebhookEndpointConfiguration;
    secrets: WebhookSecret;
  }): StoredDestination {
    const exclusive = mergeSqsUpdate({
      stored: {
        queueUrl: endpoint.sqsQueueUrl,
        roleArn: endpoint.sqsRoleArn,
        externalId: endpoint.sqsExternalId,
        accessKeyId: endpoint.sqsAccessKeyId,
        hasSecretAccessKey: Boolean(endpoint.sqsSecretAccessKeyEncrypted),
      },
      sqs,
      configuration,
    });
    const stored = PrismaWebhookEndpointRepository.storedSqsDestination(exclusive, secrets);
    return {
      ...stored,
      sqsSecretAccessKeyEncrypted:
        exclusive.secretAccessKey === WEBHOOK_KEPT_SECRET
          ? endpoint.sqsSecretAccessKeyEncrypted
          : stored.sqsSecretAccessKeyEncrypted,
    };
  }

  private static newSecret(): string {
    return `whsec_${randomBytes(32).toString("base64url")}`;
  }
}
