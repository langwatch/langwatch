import { nowInstant, toDate, type Instant } from "@langwatch/time";
import {
  WebhookEndpointNotFoundError,
  type SqsDestinationInput,
  type SqsDestinationView,
  type WebhookDeliveryOutcome,
  type WebhookDestinationKind,
  type WebhookEndpointView,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
} from "@langwatch/webhook-contract";

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
  WebhookEndpointServiceOptions,
  WebhookEndpointStatusSnapshot,
  WebhookRequestAttempt,
  WebhookRequestAttemptRow,
} from "../webhook-endpoint.repository.ts";
import {
  type MemoryWebhookDatabase,
  type MemoryWebhookEndpointRow,
} from "./memory.webhook.database.ts";

const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

let secretCounter = 0;

function newSecret(): string {
  secretCounter += 1;

  return `whsec_memory_${secretCounter}`;
}

function newExternalId(): string {
  secretCounter += 1;

  return `lw-memory-${secretCounter}`;
}

function statusSnapshotOf(row: MemoryWebhookEndpointRow): {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Instant | null;
  lastSuccessAt: Instant | null;
  lastFailureAt: Instant | null;
} {
  return {
    status: row.status,
    disabledReason: row.disabledReason,
    failingSince: row.failingSince,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
  };
}

function toView(row: MemoryWebhookEndpointRow): WebhookEndpointView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    destinationKind: row.destinationKind,
    url: row.url,
    sqs: toSqsView(row),
    enabledEvents: row.enabledEvents,
    status: row.status,
    disabledReason: row.disabledReason,
    disabledAt: row.disabledAt === null ? null : toDate(row.disabledAt),
    failingSince: row.failingSince === null ? null : toDate(row.failingSince),
    lastSuccessAt: row.lastSuccessAt === null ? null : toDate(row.lastSuccessAt),
    lastFailureAt: row.lastFailureAt === null ? null : toDate(row.lastFailureAt),
    maxBatchSize: row.maxBatchSize,
    maxBatchDelayMs: row.maxBatchDelayMs,
    maxInFlight: row.maxInFlight,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function toSqsView(row: MemoryWebhookEndpointRow): SqsDestinationView | null {
  if (row.destinationKind !== "sqs" || !row.sqsQueueUrl) return null;
  const parsed = parseSqsQueueUrl(row.sqsQueueUrl);

  return {
    queueUrl: row.sqsQueueUrl,
    region: parsed?.region ?? "",
    accountId: parsed?.accountId ?? "",
    queueName: parsed?.queueName ?? "",
    credentialMode: sqsCredentialMode({
      roleArn: row.sqsRoleArn,
      accessKeyId: row.sqsAccessKeyId,
    }),
    roleArn: row.sqsRoleArn,
    externalId: row.sqsExternalId,
    accessKeyId: row.sqsAccessKeyId,
  };
}

function storedSqsDestination(
  sqs: SqsDestinationInput,
  secrets: WebhookEndpointServiceOptions["secrets"],
): StoredDestination {
  return {
    ...EMPTY_DESTINATION,
    sqsQueueUrl: sqs.queueUrl.trim(),
    sqsRoleArn: sqs.roleArn ?? null,
    sqsExternalId: sqs.roleArn ? (sqs.externalId ?? newExternalId()) : null,
    sqsAccessKeyId: sqs.accessKeyId ?? null,
    sqsSecretAccessKeyEncrypted: sqs.secretAccessKey ? secrets.encrypt(sqs.secretAccessKey) : null,
  };
}

function storedDestination(
  params: { url?: string; sqs?: SqsDestinationInput },
  secrets: WebhookEndpointServiceOptions["secrets"],
): StoredDestination {
  if (!params.sqs) return { ...EMPTY_DESTINATION, url: params.url ?? null };
  return storedSqsDestination(params.sqs, secrets);
}

function storedSqsUpdate({
  endpoint,
  sqs,
  configuration,
  secrets,
}: {
  endpoint: MemoryWebhookEndpointRow;
  sqs: Partial<SqsDestinationInput>;
  configuration: WebhookEndpointConfiguration;
  secrets: WebhookEndpointServiceOptions["secrets"];
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
  const stored = storedSqsDestination(exclusive, secrets);

  return {
    ...stored,
    sqsSecretAccessKeyEncrypted:
      exclusive.secretAccessKey === WEBHOOK_KEPT_SECRET
        ? endpoint.sqsSecretAccessKeyEncrypted
        : stored.sqsSecretAccessKeyEncrypted,
  };
}

/**
 * The endpoint registry, in memory. Runs the same admission rules and the
 * same failure-streak bookkeeping as the Postgres twin, over a `Map` instead
 * of a table, so the app can be driven without a database.
 */
export class MemoryWebhookEndpointRepository implements WebhookEndpointRepository {
  readonly #database: MemoryWebhookDatabase;
  readonly #options: WebhookEndpointServiceOptions;
  readonly #configuration: WebhookEndpointConfiguration;

  private constructor(database: MemoryWebhookDatabase, options: WebhookEndpointServiceOptions) {
    this.#database = database;
    this.#options = options;
    this.#configuration = options.configuration ?? webhookEndpointConfiguration();
  }

  static create(input: {
    database: MemoryWebhookDatabase;
    options: WebhookEndpointServiceOptions;
  }): MemoryWebhookEndpointRepository {
    return new MemoryWebhookEndpointRepository(input.database, input.options);
  }

  async create(params: {
    organizationId: string;
    destinationKind?: WebhookDestinationKind;
    url?: string;
    sqs?: SqsDestinationInput;
    enabledEvents: string[];
    maxBatchSize?: number;
    maxBatchDelayMs?: number;
    maxInFlight?: number;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    const destinationKind = params.destinationKind ?? "http";
    const destination = storedDestination(params, this.#options.secrets);
    const secret = newSecret();
    const now = nowInstant();
    const row: MemoryWebhookEndpointRow = {
      id: this.#options.ids.newEndpointId(),
      organizationId: params.organizationId,
      destinationKind,
      ...destination,
      secretEncrypted: this.#options.secrets.encrypt(secret),
      previousSecretEncrypted: null,
      previousSecretExpiresAt: null,
      enabledEvents: params.enabledEvents,
      status: "ACTIVE",
      disabledReason: null,
      disabledAt: null,
      failingSince: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      maxBatchSize: params.maxBatchSize ?? 100,
      maxBatchDelayMs: params.maxBatchDelayMs ?? 250,
      maxInFlight: params.maxInFlight ?? 4,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#database.putEndpoint(row);

    return { endpoint: toView(row), secret };
  }

  async findAll(params: { organizationId: string }): Promise<WebhookEndpointView[]> {
    return this.#database
      .endpoints()
      .filter((row) => row.organizationId === params.organizationId && row.archivedAt === null)
      .toSorted(
        (left, right) => left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds,
      )
      .map(toView);
  }

  async getById(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    return toView(this.#live(params));
  }

  async update(params: {
    organizationId: string;
    endpointId: string;
    destinationKind?: WebhookDestinationKind;
    url?: string;
    sqs?: Partial<SqsDestinationInput>;
    enabledEvents?: string[];
    maxBatchSize?: number;
    maxBatchDelayMs?: number;
    maxInFlight?: number;
  }): Promise<WebhookEndpointView> {
    const endpoint = this.#live(params);
    const sqsUpdate =
      params.sqs !== undefined
        ? storedSqsUpdate({
            endpoint,
            sqs: params.sqs,
            configuration: this.#configuration,
            secrets: this.#options.secrets,
          })
        : {};
    const updated: MemoryWebhookEndpointRow = {
      ...endpoint,
      ...sqsUpdate,
      ...(params.url !== undefined ? { url: params.url } : {}),
      ...(params.enabledEvents !== undefined ? { enabledEvents: params.enabledEvents } : {}),
      ...(params.maxBatchSize !== undefined ? { maxBatchSize: params.maxBatchSize } : {}),
      ...(params.maxBatchDelayMs !== undefined ? { maxBatchDelayMs: params.maxBatchDelayMs } : {}),
      ...(params.maxInFlight !== undefined ? { maxInFlight: params.maxInFlight } : {}),
      updatedAt: nowInstant(),
    };

    return toView(this.#database.putEndpoint(updated));
  }

  async rollSecret(params: {
    organizationId: string;
    endpointId: string;
    now?: Instant;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
    const endpoint = this.#live(params);
    const secret = newSecret();
    const now = params.now ?? nowInstant();
    const updated = this.#database.putEndpoint({
      ...endpoint,
      secretEncrypted: this.#options.secrets.encrypt(secret),
      previousSecretEncrypted: endpoint.secretEncrypted,
      previousSecretExpiresAt: now.add({ milliseconds: WEBHOOK_PREVIOUS_SECRET_TTL_MS }),
      updatedAt: now,
    });

    return { endpoint: toView(updated), secret };
  }

  async enable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    const endpoint = this.#live(params);

    return toView(
      this.#database.putEndpoint({
        ...endpoint,
        status: "ACTIVE",
        disabledReason: null,
        disabledAt: null,
        failingSince: null,
        updatedAt: nowInstant(),
      }),
    );
  }

  async disable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView> {
    const endpoint = this.#live(params);

    return toView(
      this.#database.putEndpoint({
        ...endpoint,
        status: "DISABLED",
        disabledReason: WEBHOOK_DISABLED_REASON_MANUAL,
        disabledAt: nowInstant(),
        updatedAt: nowInstant(),
      }),
    );
  }

  async archive(params: { organizationId: string; endpointId: string }): Promise<void> {
    const endpoint = this.#live(params);
    this.#database.putEndpoint({
      ...endpoint,
      archivedAt: nowInstant(),
      status: "DISABLED",
      updatedAt: nowInstant(),
    });
  }

  async findDeliverable(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null> {
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (
      !endpoint ||
      endpoint.organizationId !== params.organizationId ||
      endpoint.status !== "ACTIVE" ||
      endpoint.archivedAt !== null
    ) {
      return null;
    }

    return toView(endpoint);
  }

  async getDeliveryDisposition(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDeliveryDisposition> {
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (
      !endpoint ||
      endpoint.organizationId !== params.organizationId ||
      endpoint.archivedAt !== null
    ) {
      return { state: "gone" };
    }
    if (endpoint.status !== "ACTIVE") return { state: "paused" };
    return { state: "deliverable", endpoint: toView(endpoint) };
  }

  async getDestinationConfig(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDestinationConfig> {
    const endpoint = this.#live(params);
    if (endpoint.destinationKind === "sqs") {
      return {
        kind: "sqs",
        queueUrl: endpoint.sqsQueueUrl ?? "",
        roleArn: endpoint.sqsRoleArn,
        externalId: endpoint.sqsExternalId,
        accessKeyId: endpoint.sqsAccessKeyId,
        secretAccessKey: endpoint.sqsSecretAccessKeyEncrypted
          ? this.#options.secrets.decrypt(endpoint.sqsSecretAccessKeyEncrypted)
          : null,
      };
    }

    return { kind: "http", url: endpoint.url ?? "" };
  }

  async getSigningSecret(params: { organizationId: string; endpointId: string }): Promise<string> {
    const endpoint = this.#live(params);

    return this.#options.secrets.decrypt(endpoint.secretEncrypted);
  }

  async findSigningSecrets(params: {
    organizationId: string;
    endpointId: string;
    now?: Instant;
  }): Promise<string[]> {
    const endpoint = this.#live(params);
    const now = params.now ?? nowInstant();
    const previousIsValid =
      endpoint.previousSecretEncrypted !== null &&
      endpoint.previousSecretExpiresAt !== null &&
      endpoint.previousSecretExpiresAt.epochMilliseconds > now.epochMilliseconds;
    const secrets = [this.#options.secrets.decrypt(endpoint.secretEncrypted)];
    if (previousIsValid)
      secrets.push(this.#options.secrets.decrypt(endpoint.previousSecretEncrypted as string));

    return secrets;
  }

  async findStatusSnapshot(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointStatusSnapshot | null> {
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (
      !endpoint ||
      endpoint.organizationId !== params.organizationId ||
      endpoint.archivedAt !== null
    ) {
      return null;
    }

    return statusSnapshotOf(endpoint);
  }

  async getDeliveryStats(params: {
    organizationId: string;
    endpointId: string;
    since: Instant;
    sampleLimit: number;
  }): Promise<{ attempted: number; delivered: number; latencies: number[] }> {
    const sinceMs = params.since.epochMilliseconds;
    const rows = this.#database
      .deliveries()
      .filter(
        (row) =>
          row.organizationId === params.organizationId &&
          row.endpointId === params.endpointId &&
          row.firedAt.epochMilliseconds > sinceMs,
      );

    return {
      attempted: rows.length,
      delivered: rows.filter((row) => row.outcome === "success").length,
      latencies: rows
        .slice()
        .toSorted((left, right) => right.firedAt.epochMilliseconds - left.firedAt.epochMilliseconds)
        .slice(0, params.sampleLimit)
        .map((row) => row.latencyMs)
        .filter((latency): latency is number => latency !== null),
    };
  }

  async findActiveByOrganization(params: {
    organizationId: string;
  }): Promise<WebhookEndpointView[]> {
    return this.#database
      .endpoints()
      .filter(
        (row) =>
          row.organizationId === params.organizationId &&
          row.status === "ACTIVE" &&
          row.archivedAt === null,
      )
      .map(toView);
  }

  async organizationIdsWithActiveEndpoints(): Promise<string[]> {
    return [
      ...new Set(
        this.#database
          .endpoints()
          .filter((row) => row.status === "ACTIVE" && row.archivedAt === null)
          .map((row) => row.organizationId),
      ),
    ];
  }

  async recordRequestAttempt(attempt: WebhookRequestAttempt): Promise<void> {
    this.#database.addRequestDelivery({
      ...attempt,
      id: this.#database.nextDeliveryId(),
      firedAt: nowInstant(),
    });
  }

  async findRequestAttempts(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookRequestAttemptRow[]> {
    return this.#database
      .requestDeliveries()
      .filter((row) => row.projectId === input.projectId && row.triggerId === input.triggerId)
      .toSorted((a, b) => b.firedAt.epochMilliseconds - a.firedAt.epochMilliseconds)
      .slice(0, input.limit);
  }

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
    const now = params.now ?? nowInstant();
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (!endpoint || endpoint.organizationId !== params.organizationId) return;

    this.#database.addDelivery({
      id: this.#database.nextDeliveryId(),
      organizationId: params.organizationId,
      endpointId: params.endpointId,
      dispatchId: params.dispatchId,
      attempt: params.attempt,
      eventCount: params.eventCount,
      outcome: params.outcome,
      responseStatus: params.responseStatus ?? null,
      latencyMs: params.latencyMs ?? null,
      error: params.error ?? null,
      firedAt: now,
    });

    if (params.outcome === "success") {
      this.#database.putEndpoint({
        ...endpoint,
        lastSuccessAt: now,
        failingSince: null,
        updatedAt: now,
      });

      return;
    }

    const failingSince = endpoint.failingSince ?? now;
    this.#database.putEndpoint({ ...endpoint, failingSince, lastFailureAt: now, updatedAt: now });
    await this.#autoDisableIfStreakExpired({
      organizationId: params.organizationId,
      endpointId: endpoint.id,
      failingSince: failingSince,
      now: now,
    });
  }

  async #autoDisableIfStreakExpired(params: {
    organizationId: string;
    endpointId: string;
    failingSince: Instant;
    now: Instant;
  }): Promise<void> {
    if (
      params.now.epochMilliseconds - params.failingSince.epochMilliseconds <
      WEBHOOK_AUTO_DISABLE_AFTER_MS
    ) {
      return;
    }
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (!endpoint || endpoint.status !== "ACTIVE") return;
    this.#database.putEndpoint({
      ...endpoint,
      status: "DISABLED",
      disabledReason: WEBHOOK_DISABLED_REASON_AUTO,
      disabledAt: params.now,
      updatedAt: params.now,
    });
    try {
      await this.#options.notifyAutoDisabled?.({
        organizationId: params.organizationId,
        endpointId: endpoint.id,
        destination: describeDestination(endpoint),
        failingSince: params.failingSince,
      });
    } catch {
      // A notification failure never undoes the disable; the caller sees no
      // difference between this and the Postgres twin's swallowed log-only
      // failure.
    }
  }

  async getDeliveries(params: {
    organizationId: string;
    endpointId: string;
    limit?: number;
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
    this.#live(params);
    const limit = Math.min(params.limit ?? 25, 200);
    const cursorFiredAtMs = params.cursor ? params.cursor.firedAt.epochMilliseconds : null;
    const rows = this.#database
      .deliveries()
      .filter(
        (row) =>
          row.organizationId === params.organizationId && row.endpointId === params.endpointId,
      )
      .filter((row) => {
        if (cursorFiredAtMs === null) return true;
        if (row.firedAt.epochMilliseconds < cursorFiredAtMs) return true;

        return (
          row.firedAt.epochMilliseconds === cursorFiredAtMs && row.id < (params.cursor?.id ?? "")
        );
      })
      .toSorted(
        (left, right) =>
          right.firedAt.epochMilliseconds - left.firedAt.epochMilliseconds ||
          (right.id < left.id ? -1 : 1),
      );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      deliveries: page.map((row) => ({
        id: row.id,
        dispatchId: row.dispatchId,
        attempt: row.attempt,
        eventCount: row.eventCount,
        outcome: row.outcome,
        responseStatus: row.responseStatus,
        latencyMs: row.latencyMs,
        error: row.error,
        firedAt: row.firedAt,
      })),
      nextCursor: rows.length > limit && last ? { firedAt: last.firedAt, id: last.id } : null,
    };
  }

  async health(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointStatusSnapshot> {
    return statusSnapshotOf(this.#live(params));
  }

  async pruneDeliveries(now: Instant = nowInstant()): Promise<number> {
    if (this.#options.pruneDeliveries) return this.#options.pruneDeliveries(now);

    return this.#database.pruneDeliveriesBefore(
      now.subtract({ milliseconds: WEBHOOK_DELIVERY_RETENTION_MS }),
    );
  }

  #live(params: { organizationId: string; endpointId: string }): MemoryWebhookEndpointRow {
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (
      !endpoint ||
      endpoint.organizationId !== params.organizationId ||
      endpoint.archivedAt !== null
    ) {
      throw new WebhookEndpointNotFoundError();
    }

    return endpoint;
  }
}
