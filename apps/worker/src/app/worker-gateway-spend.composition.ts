import { RedisCachedFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import {
  AppGatewayDebitAdapter,
  AppGatewayGovernancePort,
  GovernanceSignalDeliveryPort,
} from "@langwatch/enterprise-api";
import { AppGovernanceWebhookAdapter } from "@langwatch/enterprise-api/governance/governance-webhook.adapter";
import type {
  GovernanceBudgetCrossingData,
  GovernanceVkLifecycleData,
} from "@langwatch/enterprise-governance-server";
import { createGovernanceEventsPipeline } from "@langwatch/enterprise-governance-server";
import {
  WebhookDeliveryService,
  WebhookEndpointAdapter,
  WebhookEndpointConfiguration,
  WebhookIdPort,
  WebhookSecretPort,
  type WebhookDeliveryProcessDeps,
} from "@langwatch/enterprise-webhook-server";
import {
  EventingGatewaySpendAdapter,
  GatewayBudgetLedgerAdapter,
  GatewaySpendEventsClickHouseAdapter,
  PostgresGatewayBudgetResolutionAdapter,
  type GatewayBudgetResolutionDatabase,
  type GatewaySpendState,
} from "@langwatch/gateway-server";
import { createGatewayChangeEventsPort } from "@langwatch/gateway-server/composition/gateway-change-events";
import { WEBHOOK_DELIVERY_PROCESS_NAME } from "@langwatch/enterprise-webhook-server";
import { GATEWAY_DEBITS_PROCESS_NAME } from "@langwatch/enterprise-governance-server";
import { classifyWebhookStatus, WEBHOOK_DELIVERY_ID_HEADER } from "@langwatch/egress";
import type { WebhookEgressService } from "@langwatch/egress";
import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProcessStore } from "@langwatch/eventing";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import type { GovernanceEventsWorkerCapability } from "../features/governance/governance-events-worker-feature.installer";
import type { GatewaySpendWorkerCapability } from "../features/gateway/gateway-spend-worker-feature.installer";
import type { WorkerConfig } from "../platform/config/worker.config";

/** The Prisma models the spend graph's debit and webhook paths read and write. */
export type WorkerGatewaySpendDatabase = GatewayBudgetResolutionDatabase;

/**
 * Reports the three composition decisions the spend graph would otherwise hide.
 *
 * All three are silent in production: a settlement that never runs leaves rows
 * at `admitted` forever, an SQS endpoint that cannot be dispatched to simply
 * never receives, and an entitlement this process cannot read is the difference
 * between delivering a paid feature to everyone and to nobody.
 */
export abstract class WorkerGatewaySpendAbsenceReportPort {
  /** No all-instance ClickHouse directory: open admissions are never swept. */
  abstract withoutSpendSettlement(): void;

  /** No SQS transport: endpoints that deliver to a queue refuse by name. */
  abstract withoutSqsWebhookDestinations(): void;

  /** No entitlement graph: webhook delivery cannot read a plan and refuses. */
  abstract withoutWebhookEntitlements(): void;

  /** No credentials key: endpoint secrets cannot be read, so none is deliverable. */
  abstract withoutEndpointSecretKey(): void;
}

export type WorkerGatewaySpendCompositionInput = Readonly<{
  config: WorkerConfig;
  /** The one Prisma client this process opened. */
  database: WorkerGatewaySpendDatabase;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The queue's own Redis, for the spend fold's read-through cache. */
  redis?: RedisConnection | null;
  foldCacheTtlSeconds?: number;
  /** This process's transactional inbox and outbox. */
  processStore: ProcessStore;
  /** The SSRF-fenced sender this process already composes for automations. */
  egress: WebhookEgressService;
  /** Governance's two command proxies, published before either installs. */
  governanceCommands: {
    recordVkLifecycle: (data: GovernanceVkLifecycleData) => Promise<void>;
    recordBudgetCrossing: (data: GovernanceBudgetCrossingData) => Promise<void>;
  };
  absence?: WorkerGatewaySpendAbsenceReportPort;
  logger?: Logger;
}>;

export type WorkerGatewaySpendComposition = Readonly<{
  governance: GovernanceEventsWorkerCapability;
  spend: GatewaySpendWorkerCapability;
}>;

/**
 * The Gateway spend spine and the Governance signal log, composed and mounted
 * in this process out of packages alone.
 *
 * TEN ROUTING KEYS ACROSS TWO PIPELINES, and they are one composition because
 * neither is meaningful alone: spend's debit process delivers through
 * Governance's two commands, and Governance's delivery process has no producer
 * without spend. Splitting them would make "spend without governance"
 * expressible, and that graph silently drops every debit.
 *
 *     createGovernanceEventsPipeline           3 keys
 *       |- recordVkLifecycle, recordBudgetCrossing   pure appends
 *       `- governanceEventsDelivery            ADR-073, over the shared deps
 *     EventingGatewaySpendAdapter              7 keys
 *       |- GatewaySpendEventsClickHouseAdapter the spend ledger
 *       |- gatewaySpend fold                   behind the shared cache prefix
 *       |- admit/confirm/fail/settle           pure appends
 *       |- gatewayDebits                       budgets, crossings, delivery
 *       `- webhookDelivery                     ADR-073, over the shared deps
 *
 * RATING IS NOT HERE, and the adapter's own doc block is stale about it: the
 * fold COPIES the integer nano-USD the ingest seam priced the outcome at
 * (`gateway-spend.projection.ts`), and re-deriving it would produce a second
 * answer to a question already billed. No model cost catalog is composed.
 *
 * THE SETTLEMENT SWEEPER IS A NAMED ABSENCE. It needs every configured
 * ClickHouse instance, not a client for one tenant — one sweeper settles the
 * shared instance and every private one — and this process holds a tenant-keyed
 * resolver that cannot enumerate. Omitting it drops NO routing key (the sweeper
 * is schedule-driven and subscribes to nothing), so the absence is reported
 * rather than left to be inferred from admissions that stay open forever.
 */
export function createWorkerGatewaySpend(
  options: WorkerGatewaySpendCompositionInput,
): WorkerGatewaySpendComposition {
  const logger = options.logger ?? createLogger("langwatch:gateway-spend");
  const webhookDelivery = createWebhookDeliveryDeps(options, logger);

  options.absence?.withoutSpendSettlement();

  const governance: GovernanceEventsWorkerCapability = {
    buildProcessing: () =>
      createGovernanceEventsPipeline({
        webhookDelivery: AppGovernanceWebhookAdapter.create(webhookDelivery).build(),
      }) as never,
  };

  const spend = EventingGatewaySpendAdapter.create({
    spendEvents: GatewaySpendEventsClickHouseAdapter.create(
      options.resolveClickHouseClient as never,
    ),
    cacheStore: (inner) => cachedSpendFold(inner, options),
    webhookDelivery: {
      name: WEBHOOK_DELIVERY_PROCESS_NAME,
      applier: WebhookDeliveryService.create(webhookDelivery).processManager(),
    },
    gatewayDebits: {
      name: GATEWAY_DEBITS_PROCESS_NAME,
      applier: AppGatewayDebitAdapter.create(
        AppGatewayGovernancePort.create(
          options.database as unknown as PrismaClient,
          GatewayBudgetLedgerAdapter.create(options.resolveClickHouseClient as never),
          PostgresGatewayBudgetResolutionAdapter.create({ database: options.database }),
          createGatewayChangeEventsPort(options.database),
        ),
        new WorkerGovernanceSignalDelivery(options.governanceCommands),
      )
        .build()
        .processManager(),
    },
  });

  return {
    governance,
    spend: {
      buildProcessing: () => spend.buildProcessing() as never,
      connectSettlement: (sendSettleSpend) =>
        spend.connectSettlement(sendSettleSpend as never),
    },
  };
}

/**
 * The spend fold's read-through cache, under the prefix both graphs share.
 *
 * `gateway_spend` is a literal for the reason every other fold prefix in this
 * process is: while both graphs fold, a prefix spelled differently would give
 * this process its own empty cache and the two would stop seeing each other's
 * applied-event-id sets, so a redelivered outcome could be folded twice into a
 * row that carries money.
 */
function cachedSpendFold(
  inner: FoldProjectionStore<GatewaySpendState>,
  options: WorkerGatewaySpendCompositionInput,
): FoldProjectionStore<GatewaySpendState> {
  if (!options.redis) return inner;

  return new RedisCachedFoldStore<GatewaySpendState>(inner, options.redis, {
    keyPrefix: "gateway_spend",
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { ttlSeconds: options.foldCacheTtlSeconds }),
  });
}

/**
 * Everything both ADR-073 delivery processes read, composed once.
 *
 * The two process managers — one on the spend pipeline, one on the governance
 * pipeline — take the SAME dependency object, and that is not an economy: they
 * share the endpoint catalogue, the delivery log and the idempotency receipts,
 * so two objects would be two answers to "is this endpoint deliverable".
 */
function createWebhookDeliveryDeps(
  options: WorkerGatewaySpendCompositionInput,
  logger: Logger,
): WebhookDeliveryProcessDeps {
  return {
    processStore: options.processStore,
    endpoints: WebhookEndpointAdapter.create({
      prisma: options.database,
      ids: new WorkerWebhookIds(),
      secrets: resolveWebhookSecrets(options),
      configuration: WebhookEndpointConfiguration.create({
        allowInsecureLocalUrls: options.config.webhooks.allowInsecureLocalUrls,
        allowAmbientAwsCredentials: options.config.webhooks.allowAmbientAwsCredentials,
      }),
    }),
    pruneExpiredIdempotencyReceipts: (now) => pruneExpiredIdempotencyReceipts(options, now),
    dispatch: (input) => dispatchWebhook(options, logger, input),
    getPlan: (organizationId) => {
      options.absence?.withoutWebhookEntitlements();
      return Promise.reject(
        new Error(
          `Webhook delivery for organization ${organizationId} asked for its plan, and this process composes no entitlement graph; a plan answered here would either deliver a paid feature to an organization that did not buy it or silently stop delivering to one that did.`,
        ),
      );
    },
  };
}

/**
 * The idempotency-receipt sweep, as raw SQL and deliberately so.
 *
 * The multi-tenancy guard demands a row id or a `scopeId` on every
 * `IdempotencyReceipt` write, and an expiry sweep names neither — it is
 * system-owned maintenance across every tenant, not a tenant operation. The
 * `-- @tenancy:` marker is the guard's own sanctioned opt-out and is carried
 * verbatim, comment included, because the guard matches on it.
 */
function pruneExpiredIdempotencyReceipts(
  options: WorkerGatewaySpendCompositionInput,
  now: Date,
): Promise<unknown> {
  const database = options.database as unknown as PrismaClient;
  return database.$executeRaw`
    DELETE FROM "IdempotencyReceipt"
    WHERE "expiresAt" < ${now}
    -- @tenancy: idempotency receipt expiry sweep (system-owned maintenance)
  `;
}

/** How much of the receiver's response the delivery log keeps. */
const RESPONSE_SNIPPET_CHARS = 1000;

/**
 * One delivery attempt, through the fence this process already composes.
 *
 * The HTTP branch is the packaged `WebhookEgressService`, argument for argument
 * the same call the application's own HTTP destination makes — same SSRF fence,
 * same timeout, same redirect refusal, same signature, same dispatch cap — and
 * the verdict comes from the same `classifyWebhookStatus`, so the two cannot
 * drift about which status codes are worth retrying.
 *
 * The SQS branch REFUSES BY NAME. Its transport is 491 platform lines over the
 * AWS SQS SDK and an ambient-credential policy this process does not compose,
 * and a queue delivery that silently reported success would leave a customer
 * believing their events arrived.
 */
async function dispatchWebhook(
  options: WorkerGatewaySpendCompositionInput,
  logger: Logger,
  input: {
    destination: { kind: string; url?: string };
    organizationId: string;
    endpointId: string;
    body: string;
    batchId: string;
    attempt: number;
    signingSecrets: string[];
  },
): Promise<{
  verdict: "success" | "retryable" | "terminal";
  status: number | null;
  body: string;
  responseHeaders?: Record<string, string>;
  retryAfterMs?: number;
  error?: string;
}> {
  if (input.destination.kind !== "http" || !input.destination.url) {
    options.absence?.withoutSqsWebhookDestinations();
    logger.error(
      { organizationId: input.organizationId, endpointId: input.endpointId },
      "webhook endpoint delivers to a queue, and this process composes no queue transport",
    );
    return {
      verdict: "terminal",
      status: null,
      body: "",
      error: "This process composes no SQS webhook transport.",
    };
  }

  const result = await options.egress.send({
    url: input.destination.url,
    body: input.body,
    triggerName: input.endpointId,
    contextLabel: `Webhook endpoint ${input.endpointId}`,
    // Endpoints are organization-scoped, so their dispatch cap buckets per
    // organization rather than per project — the application's own choice.
    projectId: input.organizationId,
    eventId: input.batchId,
    dispatchIdHeader: WEBHOOK_DELIVERY_ID_HEADER,
    signingSecrets: input.signingSecrets,
    attempt: input.attempt,
    allowInsecureLocal: options.config.webhooks.allowInsecureLocalUrls,
  });

  const verdict = classifyWebhookStatus(result.status);
  return {
    verdict,
    status: result.status,
    body: result.body.slice(0, RESPONSE_SNIPPET_CHARS),
    ...(result.responseHeaders ? { responseHeaders: result.responseHeaders } : {}),
    ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
    ...(verdict === "success" ? {} : { error: `HTTP ${result.status}` }),
  };
}

/** The endpoint id format, as the resource prefix the App already mints. */
class WorkerWebhookIds extends WebhookIdPort {
  newEndpointId(): string {
    return generate("webhook_endpoint").toString();
  }
}

/**
 * The cipher a customer's endpoint secrets were written under, or one that
 * refuses.
 *
 * A deployment that configured no key has no encrypted endpoint secret to read
 * and its HTTP endpoints work; what must not happen is a no-op that returned
 * the ciphertext and signed a customer's payload with it.
 */
function resolveWebhookSecrets(options: WorkerGatewaySpendCompositionInput): WebhookSecretPort {
  const key = options.config.automation.credentialsEncryptionKey;
  if (!key) {
    options.absence?.withoutEndpointSecretKey();
    return new UnconfiguredWebhookSecrets();
  }
  return new AesGcmWebhookSecrets(AesGcmSecretEncryptionAdapter.create({ key }));
}

class AesGcmWebhookSecrets extends WebhookSecretPort {
  constructor(private readonly cipher: { encrypt(v: string): string; decrypt(v: string): string }) {
    super();
  }

  encrypt(value: string): string {
    return this.cipher.encrypt(value);
  }

  decrypt(value: string): string {
    return this.cipher.decrypt(value);
  }
}

class UnconfiguredWebhookSecrets extends WebhookSecretPort {
  encrypt(): never {
    throw new Error(
      "This process holds no credentials key; set CREDENTIALS_SECRET to store or read encrypted webhook endpoint secrets.",
    );
  }

  decrypt(): never {
    throw new Error(
      "This process holds no credentials key; set CREDENTIALS_SECRET to store or read encrypted webhook endpoint secrets.",
    );
  }
}

/**
 * The two Governance appends a spend debit makes, as this graph's own commands.
 *
 * The debit process resolves a customer's budgets, writes the debits and then
 * reports every crossing — and those reports are appends into the Governance
 * pipeline that is registered immediately before this one. The senders are the
 * installer's own late-bound proxies, so a graph that mounted spend without
 * governance fails at boot rather than dropping every crossing.
 */
class WorkerGovernanceSignalDelivery extends GovernanceSignalDeliveryPort {
  constructor(
    private readonly commands: {
      recordVkLifecycle: (data: GovernanceVkLifecycleData) => Promise<void>;
      recordBudgetCrossing: (data: GovernanceBudgetCrossingData) => Promise<void>;
    },
  ) {
    super();
  }

  available(): boolean {
    return true;
  }

  async appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void> {
    await this.commands.recordVkLifecycle(data);
  }

  async appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void> {
    await this.commands.recordBudgetCrossing(data);
  }
}
