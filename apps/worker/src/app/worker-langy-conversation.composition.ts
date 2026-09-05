import {
  ClickHouseLangyAnalyticsEventAdapter,
  LangyWorkerHttpAdapter,
  EventingLangyConversationAdapter,
  LangyAnalyticsEventStorageAdapter,
  NullLangyWorkerMetricsAdapter,
  PostgresLangyAdapter,
  LangyTokenBuffer,
  LangyTitleGeneratorService,
  LangyTurnHandoffStore,
  UnavailableLangyWorkerAdapter,
  type LangyAnalyticsClickHouseClientResolver,
  type LangyBroadcastPort,
  type LangyDatabase,
  type LangyTitleGenerator,
  type LangyTitleModelPort,
} from "@langwatch/langy-server";
import type { TenantBroadcastPort } from "@langwatch/notification-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import type { WorkerConfig } from "../platform/config/worker.config";

/** The Prisma models Langy's conversation graph reads and writes. */
export type WorkerLangyConversationDatabase = LangyDatabase;

/**
 * Reports the composition decisions Langy's conversation pipeline would otherwise hide.
 */
export abstract class WorkerLangyAbsenceReportPort {
  /** No agent manager: every dispatched turn is answered `unavailable`. */
  abstract withoutAgentManager(): void;

  /** No model resolution: conversations keep the title the customer gave them. */
  abstract withoutTitleGeneration(): void;

  /** No authorization graph: the 428 credential-recovery dispatch refuses. */
  abstract withoutSessionKeyMint(): void;
}

export type WorkerLangyConversationCompositionInput = Readonly<{
  config: WorkerConfig;
  database: WorkerLangyConversationDatabase;
  /** The queue's Redis: the token buffer and the turn handoff both live in it. */
  redis: RedisConnection;
  /** Where the content-free analytics grain lands. */
  resolveClickHouseClient: LangyAnalyticsClickHouseClientResolver;
  defaultRetentionDays: number;
  /** The one tenant publisher this process holds; absent without Redis. */
  broadcast?: TenantBroadcastPort;
  /**
   * Where a title call's model handle comes from, when this process composed a model gateway.
   */
  titleModels?: LangyTitleModelPort;
  absence?: WorkerLangyAbsenceReportPort;
  logger?: Logger;
}>;

/**
 * Langy's conversation pipeline, composed in this process out of packages alone. ALL TWENTY-FOUR
 * ROUTING KEYS.
 */
export function createWorkerLangyConversation(
  options: WorkerLangyConversationCompositionInput,
): EventingLangyConversationAdapter {
  const logger = options.logger ?? createLogger("langwatch:langy-conversation");
  const persistence = PostgresLangyAdapter.create({ database: options.database }).eventing();
  const workerMetrics = NullLangyWorkerMetricsAdapter.create();

  if (!options.config.langy) options.absence?.withoutAgentManager();
  if (!options.titleModels) options.absence?.withoutTitleGeneration();
  options.absence?.withoutSessionKeyMint();

  return EventingLangyConversationAdapter.create({
    langyConversationProjectionStore: persistence.langyConversationState,
    langyConversationTurnProjectionStore: persistence.langyConversationTurnState,
    langyMessageProjectionStore: persistence.langyMessageStorage,
    langyAnalyticsEventProjectionStore: LangyAnalyticsEventStorageAdapter.create({
      sink: ClickHouseLangyAnalyticsEventAdapter.create(options.resolveClickHouseClient),
      defaultRetentionDays: options.defaultRetentionDays,
    }),
    broadcast: new WorkerLangyTenantBroadcastAdapter(options.broadcast),
    admissions: persistence.langyTurnAdmission,
    buffer: LangyTokenBuffer.create({ redis: options.redis }),
    handoffStore: LangyTurnHandoffStore.create({ redis: options.redis }),
    worker: options.config.langy
      ? LangyWorkerHttpAdapter.create({
          agentUrl: options.config.langy.agentUrl,
          internalSecret: options.config.langy.internalSecret,
          metrics: workerMetrics,
        })
      : UnavailableLangyWorkerAdapter.create(workerMetrics),
    titleGenerator: options.titleModels
      ? LangyTitleGeneratorService.create({
          // The conversation's own message projection, read through the
          // trusted reader this package already composes: the transcript is
          // scoped by the event that asked for a title, so no user id is
          // carried and none can be forgotten.
          messages: persistence.trustedMessages,
          models: options.titleModels,
        }).generator()
      : absentTitleGenerator(logger),
    sessionKeys: new WorkerAbsentLangySessionKeys(),
  });
}

/**
 * Renames the shared publisher onto Langy's own port, or drops the broadcast.
 */
class WorkerLangyTenantBroadcastAdapter implements LangyBroadcastPort {
  constructor(private readonly broadcast: TenantBroadcastPort | undefined) {}

  async broadcastToTenant(
    tenantId: string,
    event: string,
    eventType: "langy_conversation_updated",
  ): Promise<void> {
    await this.broadcast?.broadcastToTenant({ tenantId, event, eventType });
  }
}

/**
 * Says, once per conversation that asked for a title, that this process cannot generate one.
 */
function absentTitleGenerator(logger: Logger): LangyTitleGenerator {
  return async ({ projectId, conversationId }) => {
    logger.info(
      { projectId, conversationId },
      "langy conversation title not generated: this process composes no model provider, so the conversation keeps the title it has",
    );
    return null;
  };
}

/** Refuses the 428 credential-recovery mint by name rather than minting one unscoped. */
class WorkerAbsentLangySessionKeys {
  mintForUser(): Promise<never> {
    return Promise.reject(
      new Error(
        "Langy turn recovery asked for a session key, but this process composes no API-key service to mint one with: a mint attaches an AuthZ grant, and this process registers the grants pipeline as a consumer rather than resolving its command senders, so the attach would refuse for an organization already on the ledger.",
      ),
    );
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }
}
