import {
  WebhookEndpointNotFoundError,
  WebhookEndpointValidationError,
  isValidEventSelector,
  type SqsDestinationInput,
  type SqsDestinationView,
  type WebhookDeliveryOutcome,
  type WebhookDestinationKind,
  type WebhookEndpointView,
} from "@langwatch/webhook-contract";
import { nowInstant, toDate, fromDate, type Instant } from "@langwatch/time";
import type { WebhookEndpointRuntime } from "../webhook-endpoint.repository.ts";
import type { WebhookEndpointServiceOptions } from "../webhook-endpoint.repository.ts";
import type { WebhookDestinationConfig } from "../../services/webhook-destination.service.ts";
import {
  WebhookDestinationService,
  type WebhookUrlProblemCode,
} from "../../services/webhook-destination.service.ts";
import {
  WebhookEndpointConfiguration,
  WebhookEndpointPolicyService,
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
  WEBHOOK_DISABLED_REASON_AUTO,
  WEBHOOK_DISABLED_REASON_MANUAL,
} from "../../services/webhook-endpoint-policy.service.ts";
import {
  MemoryWebhookDatabase,
  type MemoryWebhookEndpointRow,
} from "./memory.webhook-database.ts";

const WEBHOOK_PREVIOUS_SECRET_TTL_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const destinations = WebhookDestinationService.create();

const URL_PROBLEM_MESSAGES: Record<WebhookUrlProblemCode, string> = {
  invalid_url: "url must be a valid URL",
  scheme: "url must use https",
  host: "url must have a host",
  port: "url must use the default https port (443)",
  credentials: "url must not carry credentials",
};

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

/** Stands in for a stored secret the caller did not resend. */
const KEPT_SECRET = "__langwatch_kept_secret__";

let secretCounter = 0;

function newSecret(): string {
  secretCounter += 1;

  return `whsec_memory_${secretCounter}`;
}

function newExternalId(): string {
  secretCounter += 1;

  return `lw-memory-${secretCounter}`;
}

function statusSnapshotOf(row: MemoryWebhookEndpointRow) {
  return {
    status: row.status,
    disabledReason: row.disabledReason,
    failingSince: row.failingSince === null ? null : fromDate(row.failingSince),
    lastSuccessAt: row.lastSuccessAt === null ? null : fromDate(row.lastSuccessAt),
    lastFailureAt: row.lastFailureAt === null ? null : fromDate(row.lastFailureAt),
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
    disabledAt: row.disabledAt,
    failingSince: row.failingSince,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    maxBatchSize: row.maxBatchSize,
    maxBatchDelayMs: row.maxBatchDelayMs,
    maxInFlight: row.maxInFlight,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSqsView(row: MemoryWebhookEndpointRow): SqsDestinationView | null {
  if (row.destinationKind !== "sqs" || !row.sqsQueueUrl) return null;
  const parsed = destinations.findSqsQueueUrl(row.sqsQueueUrl);

  return {
    queueUrl: row.sqsQueueUrl,
    region: parsed?.region ?? "",
    accountId: parsed?.accountId ?? "",
    queueName: parsed?.queueName ?? "",
    credentialMode: destinations.sqsCredentialMode({
      roleArn: row.sqsRoleArn,
      accessKeyId: row.sqsAccessKeyId,
    }),
    roleArn: row.sqsRoleArn,
    externalId: row.sqsExternalId,
    accessKeyId: row.sqsAccessKeyId,
  };
}

function assertValidUrl(url: string, configuration: WebhookEndpointConfiguration): void {
  const problem = destinations.findUrlProblem(url, configuration.allowInsecureLocalUrls);
  if (problem) throw new WebhookEndpointValidationError(URL_PROBLEM_MESSAGES[problem]);
}

function assertValidEvents(enabledEvents: string[]): void {
  if (enabledEvents.length === 0) {
    throw new WebhookEndpointValidationError("enabled_events must select at least one event type");
  }
  for (const selector of enabledEvents) {
    if (!isValidEventSelector(selector)) {
      throw new WebhookEndpointValidationError(`unknown event selector "${selector}"`);
    }
  }
}

function assertValidSqsDestination(
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
  const mode = destinations.sqsCredentialMode({ roleArn: sqs.roleArn, accessKeyId: sqs.accessKeyId });
  if (mode === "ambient" && !configuration.allowAmbientAwsCredentials) {
    throw new WebhookEndpointValidationError(
      "sqs needs credentials of its own: either sqs.role_arn for a role to assume, or sqs.access_key_id with sqs.secret_access_key",
    );
  }
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

function assertValidDestination(
  params: { destinationKind: WebhookDestinationKind; url?: string; sqs?: SqsDestinationInput },
  configuration: WebhookEndpointConfiguration,
  secrets: WebhookEndpointServiceOptions["secrets"],
): StoredDestination {
  if (params.destinationKind === "http") {
    if (!params.url) throw new WebhookEndpointValidationError("url is required for an http endpoint");
    if (params.sqs) throw new WebhookEndpointValidationError("sqs does not apply to an http endpoint");
    assertValidUrl(params.url, configuration);

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
  assertValidSqsDestination(params.sqs, configuration);

  return storedSqsDestination(params.sqs, secrets);
}

function assertDestinationUnchanged({
  endpoint,
  params,
}: {
  endpoint: MemoryWebhookEndpointRow;
  params: { destinationKind?: WebhookDestinationKind; url?: string; sqs?: Partial<SqsDestinationInput> };
}): void {
  if (params.destinationKind !== undefined && params.destinationKind !== endpoint.destinationKind) {
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
    throw new WebhookEndpointValidationError("sqs does not apply to this endpoint; it delivers over HTTPS");
  }
}

function selects(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

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

function withExclusiveCredentials(sqs: SqsDestinationInput): SqsDestinationInput {
  if (sqs.roleArn) return { ...sqs, accessKeyId: null, secretAccessKey: null };
  if (sqs.accessKeyId) return { ...sqs, roleArn: null, externalId: null };

  return { ...sqs, roleArn: null, externalId: null, accessKeyId: null, secretAccessKey: null };
}

function assertValidSqsUpdate({
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
  const selectsRole = selects(sqs.roleArn);
  const selectsStatic = selects(sqs.accessKeyId);
  if (selectsRole && selectsStatic) {
    throw new WebhookEndpointValidationError(
      "sqs.role_arn and sqs.access_key_id select different credential modes; send one of them, and null for the other",
    );
  }
  const merged: SqsDestinationInput = {
    queueUrl: sqs.queueUrl ?? endpoint.sqsQueueUrl ?? "",
    roleArn: mergedCredentialField({ isCleared: selectsStatic, sent: sqs.roleArn, stored: endpoint.sqsRoleArn }),
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
      stored: endpoint.sqsSecretAccessKeyEncrypted ? KEPT_SECRET : null,
    }),
  };
  const exclusive = withExclusiveCredentials(merged);
  assertValidSqsDestination(exclusive, configuration);
  const stored = storedSqsDestination(exclusive, secrets);

  return {
    ...stored,
    sqsSecretAccessKeyEncrypted:
      exclusive.secretAccessKey === KEPT_SECRET
        ? endpoint.sqsSecretAccessKeyEncrypted
        : stored.sqsSecretAccessKeyEncrypted,
  };
}

/**
 * The endpoint registry, in memory. Runs the same admission rules and the
 * same failure-streak bookkeeping as the Postgres twin, over a `Map` instead
 * of a table, so the app can be driven without a database.
 */
export class MemoryWebhookEndpointRepository implements WebhookEndpointRuntime {
  readonly #database: MemoryWebhookDatabase;
  readonly #options: WebhookEndpointServiceOptions;
  readonly #configuration: WebhookEndpointConfiguration;
  readonly #policy = WebhookEndpointPolicyService.create();

  private constructor(database: MemoryWebhookDatabase, options: WebhookEndpointServiceOptions) {
    this.#database = database;
    this.#options = options;
    this.#configuration = options.configuration ?? WebhookEndpointConfiguration.create();
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
    const destination = assertValidDestination(
      { ...params, destinationKind },
      this.#configuration,
      this.#options.secrets,
    );
    assertValidEvents(params.enabledEvents);
    this.#policy.assertValidDeliveryControls(params);
    const secret = newSecret();
    const now = toDate(nowInstant());
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

  async getAll(params: { organizationId: string }): Promise<WebhookEndpointView[]> {
    return this.#database
      .endpoints()
      .filter((row) => row.organizationId === params.organizationId && row.archivedAt === null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map(toView);
  }

  async getById(params: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView> {
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
    assertDestinationUnchanged({ endpoint, params });
    if (params.url !== undefined) assertValidUrl(params.url, this.#configuration);
    const sqsUpdate =
      params.sqs !== undefined
        ? assertValidSqsUpdate({
            endpoint,
            sqs: params.sqs,
            configuration: this.#configuration,
            secrets: this.#options.secrets,
          })
        : {};
    if (params.enabledEvents !== undefined) assertValidEvents(params.enabledEvents);
    this.#policy.assertValidDeliveryControls(params);
    const updated: MemoryWebhookEndpointRow = {
      ...endpoint,
      ...sqsUpdate,
      ...(params.url !== undefined ? { url: params.url } : {}),
      ...(params.enabledEvents !== undefined ? { enabledEvents: params.enabledEvents } : {}),
      ...(params.maxBatchSize !== undefined ? { maxBatchSize: params.maxBatchSize } : {}),
      ...(params.maxBatchDelayMs !== undefined ? { maxBatchDelayMs: params.maxBatchDelayMs } : {}),
      ...(params.maxInFlight !== undefined ? { maxInFlight: params.maxInFlight } : {}),
      updatedAt: toDate(nowInstant()),
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
    const now = toDate(params.now ?? nowInstant());
    const updated = this.#database.putEndpoint({
      ...endpoint,
      secretEncrypted: this.#options.secrets.encrypt(secret),
      previousSecretEncrypted: endpoint.secretEncrypted,
      previousSecretExpiresAt: new Date(now.getTime() + WEBHOOK_PREVIOUS_SECRET_TTL_MS),
      updatedAt: now,
    });

    return { endpoint: toView(updated), secret };
  }

  async enable(params: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView> {
    const endpoint = this.#live(params);

    return toView(
      this.#database.putEndpoint({
        ...endpoint,
        status: "ACTIVE",
        disabledReason: null,
        disabledAt: null,
        failingSince: null,
        updatedAt: toDate(nowInstant()),
      }),
    );
  }

  async disable(params: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView> {
    const endpoint = this.#live(params);

    return toView(
      this.#database.putEndpoint({
        ...endpoint,
        status: "DISABLED",
        disabledReason: WEBHOOK_DISABLED_REASON_MANUAL,
        disabledAt: new Date(),
        updatedAt: toDate(nowInstant()),
      }),
    );
  }

  async archive(params: { organizationId: string; endpointId: string }): Promise<void> {
    const endpoint = this.#live(params);
    this.#database.putEndpoint({
      ...endpoint,
      archivedAt: new Date(),
      status: "DISABLED",
      updatedAt: toDate(nowInstant()),
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

  async getSigningSecrets(params: {
    organizationId: string;
    endpointId: string;
    now?: Instant;
  }): Promise<string[]> {
    const endpoint = this.#live(params);
    const now = toDate(params.now ?? nowInstant());
    const previousIsValid =
      endpoint.previousSecretEncrypted !== null &&
      endpoint.previousSecretExpiresAt !== null &&
      endpoint.previousSecretExpiresAt.getTime() > now.getTime();
    const secrets = [this.#options.secrets.decrypt(endpoint.secretEncrypted)];
    if (previousIsValid) secrets.push(this.#options.secrets.decrypt(endpoint.previousSecretEncrypted as string));

    return secrets;
  }

  async findStatusSnapshot(params: { organizationId: string; endpointId: string }) {
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
    const sinceMs = toDate(params.since).getTime();
    const rows = this.#database
      .deliveries()
      .filter(
        (row) =>
          row.organizationId === params.organizationId &&
          row.endpointId === params.endpointId &&
          row.firedAt.getTime() > sinceMs,
      );

    return {
      attempted: rows.length,
      delivered: rows.filter((row) => row.outcome === "success").length,
      latencies: rows
        .slice()
        .sort((left, right) => right.firedAt.getTime() - left.firedAt.getTime())
        .slice(0, params.sampleLimit)
        .map((row) => row.latencyMs)
        .filter((latency): latency is number => latency !== null),
    };
  }

  async getActiveByOrganization(params: { organizationId: string }): Promise<WebhookEndpointView[]> {
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
      this.#database.putEndpoint({ ...endpoint, lastSuccessAt: now, failingSince: null, updatedAt: now });

      return;
    }

    const failingSince = endpoint.failingSince ?? now;
    this.#database.putEndpoint({ ...endpoint, failingSince, lastFailureAt: now, updatedAt: now });
    await this.#autoDisableIfStreakExpired({ organizationId: params.organizationId, endpointId: endpoint.id, failingSince, now });
  }

  async #autoDisableIfStreakExpired(params: {
    organizationId: string;
    endpointId: string;
    failingSince: Date;
    now: Date;
  }): Promise<void> {
    if (params.now.getTime() - params.failingSince.getTime() < WEBHOOK_AUTO_DISABLE_AFTER_MS) return;
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
        destination: this.#policy.describeDestination(endpoint),
        failingSince: fromDate(params.failingSince),
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
  }) {
    this.#live(params);
    const limit = Math.min(params.limit ?? 25, 200);
    const cursorFiredAtMs = params.cursor ? toDate(params.cursor.firedAt).getTime() : null;
    const rows = this.#database
      .deliveries()
      .filter((row) => row.organizationId === params.organizationId && row.endpointId === params.endpointId)
      .filter((row) => {
        if (cursorFiredAtMs === null) return true;
        if (row.firedAt.getTime() < cursorFiredAtMs) return true;

        return row.firedAt.getTime() === cursorFiredAtMs && row.id < (params.cursor?.id ?? "");
      })
      .sort(
        (left, right) => right.firedAt.getTime() - left.firedAt.getTime() || (right.id < left.id ? -1 : 1),
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
        firedAt: fromDate(row.firedAt),
      })),
      nextCursor: rows.length > limit && last ? { firedAt: fromDate(last.firedAt), id: last.id } : null,
    };
  }

  async health(params: { organizationId: string; endpointId: string }) {
    return statusSnapshotOf(this.#live(params));
  }

  async pruneDeliveries(now: Instant = nowInstant()): Promise<number> {
    if (this.#options.pruneDeliveries) return this.#options.pruneDeliveries(now);

    return this.#database.pruneDeliveriesBefore(
      toDate(now.subtract({ milliseconds: WEBHOOK_DELIVERY_RETENTION_MS })),
    );
  }

  #live(params: { organizationId: string; endpointId: string }): MemoryWebhookEndpointRow {
    const endpoint = this.#database.findEndpoint(params.endpointId);
    if (!endpoint || endpoint.organizationId !== params.organizationId || endpoint.archivedAt !== null) {
      throw new WebhookEndpointNotFoundError();
    }

    return endpoint;
  }
}
