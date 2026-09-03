import {
  ClickHouseLangyAnalyticsEventAdapter,
  createLangyWorkerPort,
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
 * Reports the composition decisions Langy's conversation pipeline would
 * otherwise hide.
 *
 * All three are absences a deployment should read in its own logs at boot,
 * because each one is invisible from every other angle: the pipeline mounts,
 * every routing key is claimed, and the work simply produces nothing.
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
   * Where a title call's model handle comes from, when this process composed
   * a model gateway.
   *
   * The SAME gateway topic clustering resolves its four questions through:
   * two gateways would be two decryptions of one stored credential and two
   * answers to which model a project's title is written by. Absent means the
   * conversation keeps whatever title it has, reported by name.
   */
  titleModels?: LangyTitleModelPort;
  absence?: WorkerLangyAbsenceReportPort;
  logger?: Logger;
}>;

/**
 * Langy's conversation pipeline, composed in this process out of packages
 * alone.
 *
 * ALL TWENTY-FOUR ROUTING KEYS. The definition this returns registers every
 * key `langy_conversation_processing` declares in the byte-frozen
 * `job-registry.json` — sixteen commands, two Postgres state folds, two map
 * projections, three live subscribers and the turn process manager. A
 * definition short of one key is not a smaller deployment: the queue rejects an
 * unroutable job for redelivery rather than dropping it, so that kind of work
 * redelivers forever while the pods stay up and the queue depth grows.
 *
 *     EventingLangyConversationAdapter
 *       |- PostgresLangyAdapter.eventing()   the two folds, the message
 *       |                                    projection and the turn admissions
 *       |- ClickHouseLangyAnalyticsEventAdapter   the content-free grain
 *       |- LangyTokenBuffer / LangyTurnHandoffStore   the queue's own Redis
 *       |- createLangyWorkerPort             the agent manager, or absent
 *       |- tenant broadcast                  the shared publisher, renamed
 *       |- LangyTitleGeneratorService        the model gateway, or absent
 *       `- sessionKeys                       ABSENT (see below)
 *
 * TWO NAMED ABSENCES, both reported rather than silently answered.
 *
 * `titleGenerator` is composed where this process composed a model gateway and
 * named an execution proxy, and the generator itself is
 * `@langwatch/langy-server`'s own service over that gateway and this package's
 * trusted message reader. Both halves are now reachable: the gateway's tenancy
 * precondition is composed by `worker-tenancy.composition.ts`, so what is left
 * is the DEPLOYMENT — a process that opened no database, or one that named no
 * NLP engine. Absent, the intent answers `null`, which is the same no-op the
 * App takes for an empty transcript: the conversation keeps whatever title it
 * has.
 *
 * `sessionKeys` mints a scoped API key for the ONE recovery branch where the
 * agent manager answered `428 credentialsRequired` and the stashed handoff
 * carries no key. Two of the three things minting needs now exist here —
 * effective permissions and the org-membership read both come off the tenancy
 * graph — and the third does not: a mint ATTACHES A GRANT, and this process
 * registers the grants pipeline as a consumer rather than resolving its
 * command senders, so for an organization already on the ledger the attach
 * would refuse. Composing the minter over that would trade a named absence for
 * a mint that looks configured and fails on exactly the customers who have
 * migrated. It also wants an API-key pepper this process does not read. Absent,
 * it REFUSES BY NAME rather than minting an unscoped key: the outbox retries,
 * and the liveness subscriber terminalises the turn the way it does for any
 * dispatch that never completed. A silently skipped mint would leave the turn
 * hanging with no error anywhere.
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
      ? createLangyWorkerPort({
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
 *
 * The argument shape is the only difference between the two: Langy's port keeps
 * the application's positional `broadcastToTenant` so the application satisfies
 * it without an edit, and the shared capability takes a named input. The event
 * type is passed through rather than re-derived, so a subscriber that started
 * publishing something other than `langy_conversation_updated` would have to
 * say so at its own call site.
 *
 * Without Redis there is no publisher and no local fallback to take — this
 * process serves no tabs — so the broadcast is a no-op that the composition
 * root has already reported through `WorkerTraceAbsenceReportPort`. The
 * subscriber swallows its own failures either way, so it must not throw here.
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
 * Says, once per conversation that asked for a title, that this process cannot
 * generate one.
 *
 * A silent `null` was rejected for the reason the product-analytics sink was:
 * the App's `null` happens when a transcript is empty, and this one happens on
 * every conversation, so the two are indistinguishable in a log that carries
 * neither.
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
