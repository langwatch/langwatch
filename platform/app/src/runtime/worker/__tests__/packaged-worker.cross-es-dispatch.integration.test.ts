/**
 * Two Eventing graphs, one process, one Redis queue — the shape the switched
 * worker runs in, exercised end to end.
 *
 * After the cutover a worker pod holds two `EventSourcing` instances. The App's
 * is producer-only (`eventingConsumers: "external"`, which is byte-for-byte the
 * web-role App that has produced without consuming for months) and the packaged
 * composition's is the one consumer of `event-sourcing/jobs`. Everything the App
 * still sends therefore has to cross from one graph to the other, and a handler
 * running on the packaged consumer that dispatches a follow-up does so through a
 * producer the App resolved — the `Deferred` proxies `registerAll()` wired.
 *
 * `worker-pipeline-parity` proves both graphs answer for the same routing keys,
 * but it builds both against fake queues: it can compare two registries and
 * cannot watch a job leave one and arrive at the other. That is the one property
 * the parity guard structurally cannot see, and it is the property this file
 * asks about, on real Redis:
 *
 *   App producer  ──send(beginWork)──▶  event-sourcing/jobs  ──▶  packaged consumer
 *                                                                      │
 *                            subscriber on the committed event ────────┘
 *                                       │
 *          App producer proxy ──send(recordFollowUp)──▶  jobs  ──▶  packaged consumer
 *
 * WHAT IS REAL AND WHAT IS NOT. Real: Redis, the group queue, both queue
 * factories, the routing metadata, the packaged runtime built by
 * `packagedWorkerEventing` through `WorkerEventingRuntime.createProduction`, and
 * the `Deferred` late binding. Stood in for: the two persistence adapters
 * `EventingServerRuntime` would build — the ClickHouse event log and the Prisma
 * process store — because neither sits between a producer's `.send()` and the
 * consumer's handler, and a guard that needed them could not run wherever Redis
 * alone is up. `packaged-worker.composition` is where those two are asserted to
 * be built from the App's own instances.
 *
 * ISOLATION. Both graphs must agree on the queue NAME or nothing crosses, and
 * that name is Eventing's default — so this suite cannot rename its way out of
 * a shared key space. It pins a Redis database of its own instead: a developer's
 * `pnpm dev` worker drains `event-sourcing/jobs` on db 0, and a test consumer
 * loose in there would take its jobs and reject them for redelivery.
 */
import {
  createEventingGroupQueueFactory,
  createTenantId,
  defineAggregate,
  defineCommandSchema,
  defineEvents,
  definePipeline,
  Deferred,
  EventSourcing,
  EventUtils,
  InMemoryProcessStore,
  mapCommands,
  type AggregateType,
  type Command,
  type CommandDispatcher,
  type CommandHandler,
  type Event,
  type EventType,
} from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingServerRuntime,
  type EventingServerRuntimeOptions,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { GroupQueueDependencies } from "@langwatch/group-queue";
import { WorkerEventingRuntime } from "@langwatch/worker";
import IORedis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  packagedWorkerEventing,
  requirePackagedWorkerConsumer,
} from "~/runtime/worker/packaged-worker.capabilities";
import type {
  WorkerEventingHandoff,
  WorkerEventingSubstrate,
} from "~/server/app-layer/worker-eventing-handoff";
import { autoStub } from "./legacy-registry.fixture";

/**
 * The Redis database this suite owns.
 *
 * Not 0, and deliberately not the URL's own: `globalSetup` refuses db 0 for the
 * native integration mode for the same reason — the dev stack's queues live
 * there, under the very queue name both graphs below must use.
 */
const CROSS_ES_REDIS_DB = 12;

/**
 * Eventing's default queue name, as the group queue keys it: `defineGroupQueue`
 * wraps the name in a Redis Cluster hash tag before deriving the key prefix.
 */
const JOBS_QUEUE_KEY_PREFIX = "{event-sourcing/jobs}:gq:";

const WORK_STARTED_EVENT_TYPE = "lw.test.cutover.work_started" as EventType;
const FOLLOW_UP_RECORDED_EVENT_TYPE = "lw.test.cutover.follow_up_recorded" as EventType;

const beginWorkSchema = z.object({ tenantId: z.string(), aggregateId: z.string() });
const recordFollowUpSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  causedBy: z.string(),
});

type BeginWorkPayload = z.infer<typeof beginWorkSchema>;
type RecordFollowUpPayload = z.infer<typeof recordFollowUpSchema>;

/** What each handler saw, in the order the one consumer ran them. */
type Observed = {
  beginWork: string[];
  followUpDispatched: string[];
  recordFollowUp: string[];
};

let redis: IORedis;

beforeAll(async () => {
  redis = new IORedis(redisUrl(), {
    db: CROSS_ES_REDIS_DB,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
  });
  await redis.connect();
  await clearJobsQueue(redis);
});

afterAll(async () => {
  if (!redis) return;
  await clearJobsQueue(redis).catch(() => undefined);
  await redis.quit().catch(() => undefined);
  redis.disconnect();
});

/**
 * The local Redis, however this lane got one.
 *
 * The datastore lane's `setup.ts` has already pointed `REDIS_URL` at the
 * container or the native instance by the time a test file loads; run through a
 * config without that setup and the local default is the one every other local
 * service uses. Either way the database index above is this suite's, not the
 * URL's.
 */
function redisUrl(): string {
  return process.env.REDIS_URL ?? process.env.LANGWATCH_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
}

/**
 * Empties the one queue both graphs share.
 *
 * A previous run that ended with a job nothing could route left it to be
 * redelivered forever — including, deliberately, a sabotage run — and the next
 * run's consumer would inherit it. Scoped to the queue's own key prefix rather
 * than flushing the database, so the cleanup says exactly what it removes.
 */
async function clearJobsQueue(connection: IORedis): Promise<void> {
  const keys = await connection.keys(`${JOBS_QUEUE_KEY_PREFIX}*`);
  if (keys.length > 0) await connection.unlink(...keys);
}

/**
 * A command handler whose only job is to commit one event and say it ran.
 *
 * Two of these are all the graph needs: the property under test is where a job
 * is routed, and routing keys come from the pipeline, command and subscriber
 * NAMES a definition declares — never from what its handlers do.
 */
function commandHandlerFor(options: {
  commandType: string;
  aggregateType: string;
  eventType: EventType;
  observe: (aggregateId: string) => void;
}) {
  const { commandType, aggregateType, eventType, observe } = options;
  return class TestCommand implements CommandHandler<Command<BeginWorkPayload>, Event> {
    static readonly schema = defineCommandSchema(
      commandType as never,
      beginWorkSchema.passthrough(),
      "cross-es dispatch guard",
    );

    static getAggregateId(payload: { aggregateId: string }): string {
      return payload.aggregateId;
    }

    async handle(command: Command<BeginWorkPayload>): Promise<Event[]> {
      observe(command.data.aggregateId);
      return [
        EventUtils.createEvent({
          aggregateType: aggregateType as AggregateType,
          aggregateId: command.data.aggregateId,
          tenantId: createTenantId(command.data.tenantId),
          type: eventType,
          version: "2026-09-01",
          data: { aggregateId: command.data.aggregateId },
        }),
      ];
    }
  };
}

/** The App's substrate, as the handoff carries it: instances, not a recipe. */
function appSubstrate(
  groupQueue: GroupQueueDependencies<Record<string, unknown>>,
): WorkerEventingSubstrate {
  return {
    prisma: autoStub(),
    resolveClickHouseClient: autoStub(),
    groupQueue,
    persistenceRetention: createEventingRetentionConfiguration({ defaultRetentionDays: 30 }),
    retentionPolicyResolver: autoStub(),
    // The replay marker is threaded on the consuming side and asserted in
    // `packaged-worker.composition`; nothing here folds a projection.
    replayMarkerChecker: undefined,
  };
}

/**
 * One process holding both graphs, with a unique pipeline pair mounted on each.
 *
 * The definitions are built ONCE and registered on both runtimes — that is the
 * handoff the cutover rides, where `capabilities.definition(name)` hands the
 * packaged composition the very object the App registered. The follow-up
 * dispatcher is a `Deferred` the App resolves and the packaged side does not,
 * exactly as `registerAll()` resolves them and `workerCapabilityAlreadyConnected`
 * declines to resolve them again.
 */
function buildCrossEsProcess(options: { consumingPackagedGraph: boolean }) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const primaryName = `cutover_primary_${suffix}`;
  const secondaryName = `cutover_secondary_${suffix}`;
  const observed: Observed = { beginWork: [], followUpDispatched: [], recordFollowUp: [] };

  // Resolved against the App's producer after registration, and never resolved
  // a second time — a `Deferred` throws on the second call, so a packaged
  // installer that tried would fail loudly rather than fork the producer.
  const followUp = new Deferred<CommandDispatcher<RecordFollowUpPayload>>("recordFollowUp");
  const beginWork = new Deferred<CommandDispatcher<BeginWorkPayload>>("beginWork");

  const primaryDefinition = definePipeline<any>({
    name: primaryName,
    aggregate: defineAggregate({
      type: `${primaryName}_aggregate`,
      events: defineEvents([WORK_STARTED_EVENT_TYPE] as const),
    }),
  })
    .withCommand(
      "beginWork",
      commandHandlerFor({
        commandType: `lw.test.cutover.${primaryName}.begin_work`,
        aggregateType: `${primaryName}_aggregate`,
        eventType: WORK_STARTED_EVENT_TYPE,
        observe: (aggregateId) => observed.beginWork.push(aggregateId),
      }) as never,
    )
    .withEventSubscriber("dispatchFollowUp", {
      events: [WORK_STARTED_EVENT_TYPE],
      handler: async (event: Event) => {
        observed.followUpDispatched.push(event.aggregateId);
        await followUp.fn({
          tenantId: String(event.tenantId),
          aggregateId: `${event.aggregateId}-follow-up`,
          causedBy: event.aggregateId,
        });
      },
    } as never)
    .build();

  const secondaryDefinition = definePipeline<any>({
    name: secondaryName,
    aggregate: defineAggregate({
      type: `${secondaryName}_aggregate`,
      events: defineEvents([FOLLOW_UP_RECORDED_EVENT_TYPE] as const),
    }),
  })
    .withCommand(
      "recordFollowUp",
      commandHandlerFor({
        commandType: `lw.test.cutover.${secondaryName}.record_follow_up`,
        aggregateType: `${secondaryName}_aggregate`,
        eventType: FOLLOW_UP_RECORDED_EVENT_TYPE,
        observe: (aggregateId) => observed.recordFollowUp.push(aggregateId),
      }) as never,
    )
    .build();

  const eventStore = EventStoreMemory.createForTesting();
  const groupQueue: GroupQueueDependencies<Record<string, unknown>> = { redis };
  const handoff: WorkerEventingHandoff = {
    appOwnsEventingConsumers: false,
    isSaas: false,
    capabilities: autoStub(),
    substrate: appSubstrate(groupQueue),
    topic: autoStub(),
  };

  // The App: producer-only, the configuration presets composes for the web role
  // and now composes on the worker role too.
  const appEs = new EventSourcing({
    enabled: true,
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    queueFactory: createEventingGroupQueueFactory({
      consumersEnabled: false,
      dependencies: groupQueue,
    }),
    consumersEnabled: false,
    executionTarget: "worker",
  });

  // The packaged graph, built the way the composition root builds it: the
  // mapper decides the substrate and the consumer, `createProduction` threads
  // that decision into both the queue factory and the Eventing runtime.
  const serverRuntimeOptions: EventingServerRuntimeOptions[] = [];
  const serverRuntime = vi
    .spyOn(EventingServerRuntime, "create")
    .mockImplementation((runtimeOptions) => {
      serverRuntimeOptions.push(runtimeOptions);
      return {
        dependencies: () => ({
          eventStore,
          processStore: InMemoryProcessStore.createForTesting(),
          queueFactory: createEventingGroupQueueFactory({
            dependencies: runtimeOptions.groupQueue,
            consumersEnabled: runtimeOptions.consumersEnabled,
          }),
        }),
      } as unknown as EventingServerRuntime;
    });

  let packaged: WorkerEventingRuntime | undefined;
  try {
    if (options.consumingPackagedGraph) {
      const { consumers, ...persistence } = packagedWorkerEventing(
        requirePackagedWorkerConsumer({ handoff, clickHouseEnabled: true }),
      );
      packaged = WorkerEventingRuntime.createProduction({
        persistence,
        consumers,
        warnWhenProjectionsRunInline: false,
      });
    }
  } finally {
    serverRuntime.mockRestore();
  }

  return {
    observed,
    eventStore,
    groupQueue,
    serverRuntimeOptions,
    secondaryName,

    /**
     * Mounts the pair on both graphs and resolves the App's producer proxy.
     *
     * The packaged graph registers first, because that is the order the switch
     * cannot avoid: the consumer is a construction-time side effect of creating
     * a queue definition, so it is live from the first registration either way.
     */
    async start(): Promise<void> {
      if (packaged) {
        for (const definition of [primaryDefinition, secondaryDefinition]) {
          packaged.eventSourcing.register(definition as never);
        }
        packaged.completeRegistrations();
        await packaged.start();
      }
      const appPrimary = appEs.register(primaryDefinition as never);
      const appSecondary = appEs.register(secondaryDefinition as never);
      await appEs.globalQueue?.waitUntilReady();
      followUp.resolve(mapCommands(appSecondary.commands).recordFollowUp as never);
      beginWork.resolve(mapCommands(appPrimary.commands).beginWork as never);
    },

    /** The App's own producer for the first command, once `start()` wired it. */
    beginWork: (payload: BeginWorkPayload): Promise<void> => beginWork.fn(payload),

    async close(): Promise<void> {
      await packaged?.close().catch(() => undefined);
      await appEs.close().catch(() => undefined);
    },
  };
}

type CrossEsProcess = ReturnType<typeof buildCrossEsProcess>;

describe("packaged worker cross-graph dispatch", () => {
  let world: CrossEsProcess | undefined;

  afterEach(async () => {
    await world?.close();
    world = undefined;
    await clearJobsQueue(redis);
  });

  describe("given an App producer and a packaged consumer over one group queue", () => {
    /**
     * The whole crossing, in one job's lifetime. Nothing in the definitions
     * knows which runtime will run them: routing metadata is stamped from the
     * pipeline, command and subscriber names at send time, so a handler that
     * dispatches through the App's producer enqueues the identical bytes the
     * App's own callers would.
     */
    it("carries a command across, and the follow-up its handler dispatches back", async () => {
      world = buildCrossEsProcess({ consumingPackagedGraph: true });
      await world.start();
      const tenantId = `cross-es-${Math.random().toString(36).slice(2, 8)}`;
      const aggregateId = `${tenantId}-work`;

      await world.beginWork({ tenantId, aggregateId });

      await vi.waitFor(
        () => {
          expect(world!.observed.beginWork).toEqual([aggregateId]);
          expect(world!.observed.recordFollowUp).toEqual([`${aggregateId}-follow-up`]);
        },
        { timeout: 20_000, interval: 100 },
      );
      expect(world.observed.followUpDispatched).toEqual([aggregateId]);
    });

    /**
     * The follow-up is committed by the consumer, not merely dispatched by it:
     * a subscriber that enqueued a job nothing routed would still push its own
     * marker above, and the queue would redeliver the job rather than say so.
     */
    it("commits the follow-up's own event to the shared store", async () => {
      world = buildCrossEsProcess({ consumingPackagedGraph: true });
      await world.start();
      const tenantId = `cross-es-${Math.random().toString(36).slice(2, 8)}`;
      const aggregateId = `${tenantId}-work`;

      await world.beginWork({ tenantId, aggregateId });

      await vi.waitFor(
        async () => {
          const events = await world!.eventStore.getEvents(
            `${aggregateId}-follow-up`,
            { tenantId: createTenantId(tenantId) },
            `${world!.secondaryName}_aggregate` as AggregateType,
          );
          expect(events.map((event) => event.type)).toEqual([FOLLOW_UP_RECORDED_EVENT_TYPE]);
        },
        { timeout: 20_000, interval: 100 },
      );
    });

    /**
     * The mapper's two decisions, read off the options the production runtime
     * actually received rather than off the object the mapper returned: this is
     * the one place in the process allowed to ask for consumers, and it joins
     * the App's own group-queue dependencies rather than building a second set
     * over a second Redis connection.
     */
    it("asks for consumers on the App's own group-queue dependencies", async () => {
      world = buildCrossEsProcess({ consumingPackagedGraph: true });
      await world.start();

      expect(world.serverRuntimeOptions).toHaveLength(1);
      expect(world.serverRuntimeOptions[0]!.consumersEnabled).toBe(true);
      expect(world.serverRuntimeOptions[0]!.groupQueue).toBe(world.groupQueue);
    });
  });

  describe("given the App producer with no packaged consumer beside it", () => {
    /**
     * The safety property the whole cutover leans on, stated as an observation
     * rather than as a claim about presets: an App with consumers off holds a
     * working producer surface and takes nothing off the queue. If this ever
     * failed, the switched worker would hold two consumers of one queue.
     */
    it("enqueues the command and consumes nothing", async () => {
      world = buildCrossEsProcess({ consumingPackagedGraph: false });
      await world.start();
      const tenantId = `cross-es-${Math.random().toString(36).slice(2, 8)}`;
      const aggregateId = `${tenantId}-work`;

      await world.beginWork({ tenantId, aggregateId });
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      expect(world.observed.beginWork).toEqual([]);
      expect(world.observed.followUpDispatched).toEqual([]);
      expect(await redis.keys(`${JOBS_QUEUE_KEY_PREFIX}*`)).not.toEqual([]);
    });
  });
});
