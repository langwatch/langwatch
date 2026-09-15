import { RedisCachedFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import {
  AppGatewayDebitAdapter,
  AppGatewayGovernance,
  GovernanceSignalDelivery,
} from "@langwatch/enterprise-api";
import { AppGovernanceWebhookAdapter } from "@langwatch/enterprise-api/governance/governance-webhook.adapter";
import type {
  GovernanceBudgetCrossingData,
  GovernanceVkLifecycleData,
} from "@langwatch/enterprise-governance-server";
import { GovernanceEventsAdapter } from "@langwatch/enterprise-governance-server";
import {
  HttpWebhookDestinationAdapter,
  WebhookDeliveryService,
  WebhookDestinationAdapter,
  type WebhookSecret,
  webhookRepositories,
  type AwsClientConfigResolver,
  type WebhookDeliveryProcessDeps,
  type WebhookDispatchRequest,
  type WebhookEndpointDeps,
} from "@langwatch/webhook-server";
import { instantiateRepositories } from "@langwatch/runtime-composition";
import {
  ClickHouseGatewayOpenAdmissionsAdapter,
  EventingGatewaySpendAdapter,
  GatewayBudgetChangeDedupeService,
  GatewayBudgetClickHouseRepository,
  GatewaySpendEventsRepository,
  PostgresGatewayBudgetResolutionAdapter,
  RedisGatewayBudgetChangeDedupeRepository,
  settlementGraceMs,
  type GatewayBudgetResolutionDatabase,
  type GatewayClickHouseInstanceResolver,
  type GatewaySpendState,
  type SpendSettlementProcessDeps,
} from "@langwatch/gateway-server";
import { PrismaGatewayChangeEventsRepository } from "@langwatch/gateway-server/composition/gateway-change-events";
import { WEBHOOK_DELIVERY_PROCESS_NAME } from "@langwatch/webhook-server";
import { GATEWAY_DEBITS_PROCESS_NAME } from "@langwatch/enterprise-governance-server";
import type { WebhookDispatchRateLimiter, WebhookEgressService } from "@langwatch/egress";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProcessStore } from "@langwatch/eventing";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import type { GovernanceEventsWorkerCapability } from "../features/governance/governance-events-worker-feature.installer.ts";
import type { GatewaySpendWorkerCapability } from "../features/gateway/gateway-spend-worker-feature.installer.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";

/** The Prisma models the spend graph's debit and webhook paths read and write. */
export type WorkerGatewaySpendDatabase = GatewayBudgetResolutionDatabase &
  WebhookEndpointDeps["prisma"];

/**
 * Reports composition decisions the spend graph would otherwise hide, each
 * silent in production (a stalled settlement, an undeliverable SQS endpoint,
 * an unreadable entitlement). The first two depend on which substrates the
 * graph was handed, not what this package can build.
 */
export abstract class WorkerGatewaySpendAbsenceReport {
  /** No all-instance ClickHouse directory: open admissions are never swept. */
  abstract withoutSpendSettlement(): void;

  /** No AWS transport: endpoints that deliver to a queue refuse by name. */
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
  /**
   * Every configured ClickHouse endpoint, shared and private — the
   * settlement sweeper's read side; it asks each instance directly rather than
   * routing through a tenant resolver
   */
  resolveClickHouseInstances?: GatewayClickHouseInstanceResolver;
  /** The queue's own Redis, for the spend fold's read-through cache. */
  redis?: RedisConnection | null;
  foldCacheTtlSeconds?: number;
  /** This process's transactional inbox and outbox. */
  processStore: ProcessStore;
  /** The SSRF-fenced sender this process already composes for automations. */
  egress: WebhookEgressService;
  /**
   * How this process builds an AWS transport (proxy, TLS agent, assumed role).
   * Absent leaves a queue endpoint undeliverable; a client built here would
   * bypass a self-hosted install's own egress proxy.
   */
  awsClientConfig?: AwsClientConfigResolver;
  /**
   * The counter the hourly dispatch cap is kept in — the HTTPS transport
   * reads it off the egress service, but a queue send never passes through
   * that sender, so it's handed the same counter directly to stay capped.
   */
  dispatchRateLimiter?: WebhookDispatchRateLimiter;
  /**
   * Which plan an organization is on, for the live-delivery gate (webhook
   * endpoints are a paid entitlement). Absent exactly when this graph
   * composed no typed Prisma client, so the gate refuses rather than guessing.
   */
  plans?: PlanProvider;
  /** Governance's two command proxies, published before either installs. */
  governanceCommands: {
    recordVkLifecycle: (data: GovernanceVkLifecycleData) => Promise<void>;
    recordBudgetCrossing: (data: GovernanceBudgetCrossingData) => Promise<void>;
  };
  absence?: WorkerGatewaySpendAbsenceReport;
  logger?: Logger;
}>;

export type WorkerGatewaySpendComposition = Readonly<{
  governance: GovernanceEventsWorkerCapability;
  spend: GatewaySpendWorkerCapability;
}>;

/**
 * The Gateway spend spine and Governance signal log composed as ONE pipeline;
 * splitting them silently drops debits. Rating is not here (fold copies
 * already-priced amount); settlement sweeper needs the full instance directory.
 */
export function createWorkerGatewaySpend(
  options: WorkerGatewaySpendCompositionInput,
): WorkerGatewaySpendComposition {
  const logger = options.logger ?? createLogger("langwatch:gateway-spend");
  const webhookDelivery = createWebhookDeliveryDeps(options, logger);
  const settlement = resolveSpendSettlement(options);

  const governance: GovernanceEventsWorkerCapability = {
    buildProcessing: () =>
      GovernanceEventsAdapter.create({
        webhookDelivery: AppGovernanceWebhookAdapter.create(webhookDelivery).build(),
      }).pipeline() as never,
  };

  const spend = EventingGatewaySpendAdapter.create({
    spendEvents: GatewaySpendEventsRepository.create(
      options.resolveClickHouseClient as never,
    ),
    cacheStore: (inner) => cachedSpendFold(inner, options),
    ...(settlement ? { settlement } : {}),
    webhookDelivery: {
      name: WEBHOOK_DELIVERY_PROCESS_NAME,
      applier: WebhookDeliveryService.create(webhookDelivery).processManager(),
    },
    gatewayDebits: {
      name: GATEWAY_DEBITS_PROCESS_NAME,
      applier: AppGatewayDebitAdapter.create(
        AppGatewayGovernance.create(
          options.database as unknown as PrismaClient,
          GatewayBudgetClickHouseRepository.create(options.resolveClickHouseClient as never),
          PostgresGatewayBudgetResolutionAdapter.create({ database: options.database }),
          PrismaGatewayChangeEventsRepository.create(options.database),
          // Without this the advisory BUDGET_UPDATED fires on EVERY debit, so a
          // busy project evicts its own gateway bundles as fast as it spends.
          // A process with no Redis gets the always-emit stand-in, which is what
          // this path did before the window existed.
          GatewayBudgetChangeDedupeService.create(
            options.redis ? RedisGatewayBudgetChangeDedupeRepository.create(options.redis) : null,
          ),
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
      connectSettlement: (sendSettleSpend) => spend.connectSettlement(sendSettleSpend as never),
    },
  };
}

/**
 * The settlement sweeper's read side, or none. Grace passed as the raw string
 * the deployment set; `settlementGraceMs` owns the parse and validation.
 */
function resolveSpendSettlement(
  options: WorkerGatewaySpendCompositionInput,
): Omit<SpendSettlementProcessDeps, "sendSettleSpend"> | undefined {
  const resolveInstances = options.resolveClickHouseInstances;
  if (!resolveInstances) {
    options.absence?.withoutSpendSettlement();
    return undefined;
  }

  const admissions = ClickHouseGatewayOpenAdmissionsAdapter.create(resolveInstances);
  return {
    findOpenAdmissions: (params) => admissions.findOpenAdmissions(params),
    graceMs: settlementGraceMs(options.config.gateway.spendSettlementGraceMs),
  };
}

/**
 * The last hop for one endpoint. Both transports use the same egress fence
 * and signature; verification code works when integration moves URL->queue.
 */
export function dispatchWebhookThrough(
  options: WorkerGatewaySpendCompositionInput,
  logger: Logger,
): WebhookDeliveryProcessDeps["dispatch"] {
  const allowInsecureLocal = options.config.webhooks.allowInsecureLocalUrls;
  const awsClientConfig = options.awsClientConfig;

  return async (input) => {
    if (!awsClientConfig) {
      if (input.destination.kind === "sqs") {
        options.absence?.withoutSqsWebhookDestinations();
        logger.error(
          { organizationId: input.organizationId, endpointId: input.endpointId },
          "webhook endpoint delivers to a queue, and this process composes no AWS transport",
        );
        return {
          verdict: "terminal",
          status: null,
          body: "",
          error: "This process composes no AWS transport for queue webhook destinations.",
        };
      }
      return HttpWebhookDestinationAdapter.create({
        url: input.destination.url,
        egress: options.egress,
        allowInsecureLocal,
      }).send(dispatchRequestFor(input));
    }

    return WebhookDestinationAdapter.create({
      egress: options.egress,
      allowInsecureLocal,
      awsClientConfig,
      ...(options.dispatchRateLimiter ? { rateLimiter: options.dispatchRateLimiter } : {}),
    })
      .destinationFor(input.destination)
      .send(dispatchRequestFor(input));
  };
}

/** The batch as a transport asks for it: the same bytes, either hop. */
function dispatchRequestFor(
  input: Parameters<WebhookDeliveryProcessDeps["dispatch"]>[0],
): WebhookDispatchRequest {
  return {
    organizationId: input.organizationId,
    endpointId: input.endpointId,
    body: input.body,
    batchId: input.batchId,
    attempt: input.attempt,
    signingSecrets: input.signingSecrets,
  };
}

/**
 * The spend fold's read-through cache, under the prefix both graphs share
 * literally (`gateway_spend`); different spelling would give this process its
 * own empty cache.
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
 * Everything both ADR-073 delivery processes read, composed once: the two
 * process managers share ONE dependency object so they don't disagree on
 * endpoint deliverability.
 */
function createWebhookDeliveryDeps(
  options: WorkerGatewaySpendCompositionInput,
  logger: Logger,
): WebhookDeliveryProcessDeps {
  return {
    processStore: options.processStore,
    endpoints: instantiateRepositories(webhookRepositories, {
      tier: "live",
      members: {
        prisma: options.database,
        clickhouse: options.resolveClickHouseClient,
        encryption: resolveWebhookSecrets(options),
      },
    }).endpoints,
    pruneExpiredIdempotencyReceipts: (now) => pruneExpiredIdempotencyReceipts(options, now),
    dispatch: dispatchWebhookThrough(options, logger),
    getPlan: resolveWebhookPlan(options),
  };
}

/**
 * The entitlement the delivery gate reads, or the refusal standing in for it
 * — the deployment's own subscription rows/baseline, so the settings screen
 * and the delivery process see the same answer.
 */
export function resolveWebhookPlan(
  options: WorkerGatewaySpendCompositionInput,
): WebhookDeliveryProcessDeps["getPlan"] {
  const plans = options.plans;
  if (!plans) {
    options.absence?.withoutWebhookEntitlements();

    return (organizationId) =>
      Promise.reject(
        new Error(
          `Webhook delivery for organization ${organizationId} asked for its plan, and this process composes no entitlement graph; a plan answered here would either deliver a paid feature to an organization that did not buy it or silently stop delivering to one that did.`,
        ),
      );
  }

  return (organizationId) => plans.getActivePlan({ organizationId });
}

/**
 * The idempotency-receipt sweep, as raw SQL and deliberately so: it is
 * system-owned maintenance across every tenant, not a tenant operation, so
 * it carries the guard's own `-- @tenancy:` opt-out marker verbatim (the guard matches on it).
 */
function pruneExpiredIdempotencyReceipts(
  options: WorkerGatewaySpendCompositionInput,
  now: Parameters<WebhookDeliveryProcessDeps["pruneExpiredIdempotencyReceipts"]>[0],
): Promise<unknown> {
  const database = options.database as unknown as PrismaClient;
  return database.$executeRaw`
    DELETE FROM "IdempotencyReceipt"
    WHERE "expiresAt" < ${now}
    -- @tenancy: idempotency receipt expiry sweep (system-owned maintenance)
  `;
}

/**
 * The cipher a customer's endpoint secrets were written under, or one that
 * refuses — a deployment with no key has no encrypted secret to read; what
 * must not happen is a no-op that signs a customer's payload with the ciphertext.
 */
function resolveWebhookSecrets(options: WorkerGatewaySpendCompositionInput): WebhookSecret {
  const key = options.config.automation.credentialsEncryptionKey;
  if (!key) {
    options.absence?.withoutEndpointSecretKey();
    return new UnconfiguredWebhookSecrets();
  }
  return new AesGcmWebhookSecrets(AesGcmSecretEncryptionAdapter.create({ key }));
}

class AesGcmWebhookSecrets implements WebhookSecret {
  constructor(private readonly cipher: { encrypt(v: string): string; decrypt(v: string): string }) {}

  encrypt(value: string): string {
    return this.cipher.encrypt(value);
  }

  decrypt(value: string): string {
    return this.cipher.decrypt(value);
  }
}

class UnconfiguredWebhookSecrets implements WebhookSecret {
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
 * The Governance appends a spend debit makes. The debit process reports
 * crossings into the governance pipeline, so spend without governance fails at boot.
 */
class WorkerGovernanceSignalDelivery extends GovernanceSignalDelivery {
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
