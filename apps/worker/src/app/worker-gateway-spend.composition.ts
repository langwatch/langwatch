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
  httpWebhookDestination,
  webhookDestinationFor,
  WebhookDeliveryService,
  WebhookEndpointAdapter,
  WebhookEndpointConfiguration,
  WebhookIdPort,
  WebhookSecretPort,
  type AwsClientConfigPort,
  type WebhookDeliveryProcessDeps,
  type WebhookDispatchRequest,
} from "@langwatch/enterprise-webhook-server";
import {
  ClickHouseGatewayOpenAdmissionsAdapter,
  EventingGatewaySpendAdapter,
  GatewayBudgetLedgerAdapter,
  GatewaySpendEventsClickHouseAdapter,
  PostgresGatewayBudgetResolutionAdapter,
  settlementGraceMs,
  type GatewayBudgetResolutionDatabase,
  type GatewayClickHouseInstanceResolver,
  type GatewaySpendState,
  type SpendSettlementProcessDeps,
} from "@langwatch/gateway-server";
import { createGatewayChangeEventsPort } from "@langwatch/gateway-server/composition/gateway-change-events";
import { WEBHOOK_DELIVERY_PROCESS_NAME } from "@langwatch/enterprise-webhook-server";
import { GATEWAY_DEBITS_PROCESS_NAME } from "@langwatch/enterprise-governance-server";
import type { WebhookDispatchRateLimiterPort, WebhookEgressService } from "@langwatch/egress";
import type { PlanProvider } from "@langwatch/entitlement-contract";
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
 * Reports the composition decisions the spend graph would otherwise hide.
 *
 * Each is silent in production: a settlement that never runs leaves rows at
 * `admitted` forever, an SQS endpoint that cannot be dispatched to simply
 * never receives, and an entitlement this process cannot read is the difference
 * between delivering a paid feature to everyone and to nobody.
 *
 * The first two are CONDITIONAL, and their condition is which substrates the
 * graph was handed rather than what this package can build. A graph that
 * opened its own ClickHouse connection can enumerate every configured
 * endpoint and sweeps; one handed a tenant-keyed RESOLVER cannot, and says so.
 * A graph that owns the process's AWS transport delivers to a queue; one built
 * over already-composed technical ports has none to deliver through.
 */
export abstract class WorkerGatewaySpendAbsenceReportPort {
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
   * Every configured ClickHouse endpoint, shared and private alike.
   *
   * The settlement sweeper's read side, and the one thing the tenant-keyed
   * resolver above cannot answer: one sweeper settles the whole install, so it
   * asks each instance for its own open admissions rather than routing a
   * tenant to one. A graph handed only a resolver passes none and the sweep is
   * reported absent by name.
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
   * How this process builds an AWS transport: the corporate proxy, the TLS
   * agent, the assumed role. Absent leaves a queue endpoint undeliverable,
   * which is reported rather than answered with a client of this module's own
   * making — one built here would bypass whatever proxy a self-hosted install
   * routes its egress through.
   */
  awsClientConfig?: AwsClientConfigPort;
  /**
   * The counter the hourly dispatch cap is kept in.
   *
   * The HTTPS transport reads it off the egress service; a queue send never
   * passes through that sender, so it is handed the same counter directly or a
   * queue endpoint would be the one uncapped destination in the product.
   */
  dispatchRateLimiter?: WebhookDispatchRateLimiterPort;
  /**
   * Which plan an organization is on, for the live-delivery gate.
   *
   * Webhook endpoints are a paid entitlement, so this decides whether a batch
   * leaves at all. Absent exactly when this graph composed no typed Prisma
   * client, in which case the gate refuses rather than guessing — a baseline
   * answered here would silently stop delivering to organizations that bought
   * the feature, and an unconditional yes would deliver it to ones that did not.
   */
  plans?: PlanProvider;
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
 * THE SETTLEMENT SWEEPER IS MOUNTED WHERE THE GRAPH CAN ENUMERATE. It needs
 * every configured ClickHouse instance, not a client for one tenant — one
 * sweeper settles the shared instance and every private one — so it takes the
 * instance directory rather than the tenant-keyed resolver everything else
 * here runs through. A graph that opened its own connection has that
 * directory; one handed a resolver as a port does not, and the absence is
 * reported rather than left to be inferred from admissions that stay open
 * forever. Either way it drops NO routing key: the sweeper is schedule-driven
 * and subscribes to nothing.
 */
export function createWorkerGatewaySpend(
  options: WorkerGatewaySpendCompositionInput,
): WorkerGatewaySpendComposition {
  const logger = options.logger ?? createLogger("langwatch:gateway-spend");
  const webhookDelivery = createWebhookDeliveryDeps(options, logger);
  const settlement = resolveSpendSettlement(options);

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
    ...(settlement ? { settlement } : {}),
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
      connectSettlement: (sendSettleSpend) => spend.connectSettlement(sendSettleSpend as never),
    },
  };
}

/**
 * The settlement sweeper's read side, or the reason there is none.
 *
 * The grace is passed as the raw string the deployment set, because
 * `settlementGraceMs` owns the parse, its lower bound and the warning it logs
 * — and the REST settlement policy the API serves calls the same function on
 * the same variable. Parsing here as well is how the two ends of one grace
 * window drift apart.
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
 * The last hop for one endpoint, whichever transport it named.
 *
 * Both branches are the packaged ones rather than this module's: the HTTPS
 * branch is the same egress service, the same fence, the same signature and
 * the same `classifyWebhookStatus` verdict a hand-rolled twin here used to
 * produce, and the queue branch is the AWS SQS transport that twin refused by
 * name. One function answering for both is what keeps a customer's
 * verification code working when they move an integration from a URL to a
 * queue.
 *
 * Without an AWS transport there is no queue branch to build. A client built
 * here instead would bypass whatever proxy a self-hosted install routes its
 * egress through, so the absence is reported and a queue endpoint refuses.
 *
 * Exported because it is the one composition decision here that is only
 * observable at DELIVERY time: everything else this module decides is visible
 * in the built pipeline definition, and this is not, so a test that could not
 * reach it could not tell a graph that delivers to a queue from one that
 * refuses.
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
      return httpWebhookDestination({
        url: input.destination.url,
        egress: options.egress,
        allowInsecureLocal,
      }).send(dispatchRequestFor(input));
    }

    return webhookDestinationFor(input.destination, {
      egress: options.egress,
      allowInsecureLocal,
      awsClientConfig,
      ...(options.dispatchRateLimiter ? { rateLimiter: options.dispatchRateLimiter } : {}),
    }).send(dispatchRequestFor(input));
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
    dispatch: dispatchWebhookThrough(options, logger),
    getPlan: resolveWebhookPlan(options),
  };
}

/**
 * The entitlement the delivery gate reads, or the refusal that stands in for it.
 *
 * The provider is the deployment's own — the same subscription rows and the
 * same baseline the interactive process resolves from — so an organization
 * whose endpoints the settings screen shows as enabled is one this process
 * actually delivers to. Without it the gate refuses BY NAME: `getPlan` is
 * awaited before a batch leaves, so a rejection stops the delivery instead of
 * answering a plan nobody can stand behind.
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
