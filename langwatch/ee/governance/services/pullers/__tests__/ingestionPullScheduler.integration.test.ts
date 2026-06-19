// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
/**
 * Integration coverage for the event-sourced pull scheduler against a REAL
 * GroupQueue (Redis) + REAL Postgres. Proves seeding, idempotency, crash-safe
 * re-arm-before-work, per-source serialization, and stop-on-archive on the same
 * durable queue everything else uses — no BullMQ, no Linux cron.
 *
 * Spec: specs/ai-governance/puller-framework/event-sourced-scheduling.feature
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { prisma } from "~/server/db";
import { type AggregateType, definePipeline } from "~/server/event-sourcing";
import {
  getTestClickHouseClient,
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import { EventStoreClickHouse } from "~/server/event-sourcing/stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "~/server/event-sourcing/stores/repositories/eventRepositoryClickHouse";

import {
  armIngestionPullForSource,
  type IngestionPullPayload,
  registerIngestionPullJob,
  seedIngestionPullers,
} from "../ingestionPullScheduler";
import { type PullResult, pullerAdapterRegistry } from "../pullerAdapter";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

// A controllable fixture adapter: returns a fixed cursor + no events (so the
// pull body never touches ClickHouse), records call count + max concurrency,
// and can block inside runOnce on a release gate so in-flight state is
// observable.
type FixtureControl = {
  calls: number;
  inFlight: number;
  maxInFlight: number;
  cursor: string | null;
  gate: Promise<void> | null;
};
let control: FixtureControl;

function freshControl(): FixtureControl {
  return {
    calls: 0,
    inFlight: 0,
    maxInFlight: 0,
    cursor: "advanced",
    gate: null,
  };
}

const FIXTURE_ADAPTER_ID = "fixture_pull_scheduler";

class FixturePullerAdapter {
  readonly id = FIXTURE_ADAPTER_ID;
  validateConfig(config: unknown): { adapter: string } {
    return config as { adapter: string };
  }
  async runOnce(): Promise<PullResult> {
    control.calls += 1;
    control.inFlight += 1;
    control.maxInFlight = Math.max(control.maxInFlight, control.inFlight);
    try {
      if (control.gate !== null) await control.gate;
      return { events: [], cursor: control.cursor, errorCount: 0 };
    } finally {
      control.inFlight -= 1;
    }
  }
}

describe.skipIf(!hasTestcontainers)(
  "ingestionPullScheduler — event-sourced scheduling end-to-end",
  () => {
    let redis: Redis;
    let eventSourcing: EventSourcing;
    let pullJob: ReturnType<typeof registerIngestionPullJob>;
    let organizationId: string;

    beforeAll(async () => {
      await startTestContainers();
      redis = getTestRedisConnection()!;
      const clickHouseClient = getTestClickHouseClient()!;

      eventSourcing = EventSourcing.createWithStores({
        eventStore: new EventStoreClickHouse(
          new EventRepositoryClickHouse(async () => clickHouseClient),
        ),
        clickhouse: async () => clickHouseClient,
        redis,
        processRole: "worker",
      });

      // A minimal pipeline just to obtain a service bound to the global queue,
      // then register the recurring pull job on it (the same call pipelineRegistry
      // makes in production).
      const registered = eventSourcing.register(
        definePipeline()
          .withName(`ingestion_pull_scheduler_test_${nanoid(6)}`)
          .withAggregateType("trace" as AggregateType)
          .build(),
      );
      pullJob = registerIngestionPullJob(registered.service);
      await registered.service.waitUntilReady();

      if (!pullerAdapterRegistry.get(FIXTURE_ADAPTER_ID)) {
        pullerAdapterRegistry.register(new FixturePullerAdapter());
      }

      const organization = await prisma.organization.create({
        data: {
          name: `pull-sched ${nanoid(6)}`,
          slug: `--pull-sched-${nanoid(8)}`,
        },
      });
      organizationId = organization.id;
    });

    beforeEach(async () => {
      await redis.flushall();
      control = freshControl();
    });

    afterAll(async () => {
      await eventSourcing.close().catch(() => {});
      await stopTestContainers();
    });

    async function createSource(opts?: {
      pullSchedule?: string | null;
      status?: string;
      archivedAt?: Date | null;
    }): Promise<string> {
      const source = await prisma.ingestionSource.create({
        data: {
          organizationId,
          sourceType: "claude_compliance",
          name: `pull-sched-source-${nanoid(8)}`,
          ingestSecretHash: `hash-${nanoid(8)}`,
          status: opts?.status ?? "active",
          archivedAt: opts?.archivedAt ?? null,
          pullSchedule:
            opts?.pullSchedule === undefined
              ? "*/15 * * * *"
              : opts.pullSchedule,
          parserConfig: { adapter: FIXTURE_ADAPTER_ID },
        },
      });
      return source.id;
    }

    // Count jobs pending in the source's group ZSET. The group key embeds the
    // source id, so this scans precisely that group's staging set.
    async function pendingPullCount(sourceId: string): Promise<number> {
      const keys = await redis.keys(`*${sourceId}:jobs`);
      let total = 0;
      for (const key of keys) {
        total += await redis.zcard(key);
      }
      return total;
    }

    function send(
      sourceId: string,
      options?: { delay?: number },
    ): Promise<void> {
      const payload: IngestionPullPayload = {
        ingestionSourceId: sourceId,
        tenantId: organizationId,
      };
      return pullJob!.send(payload, { delay: options?.delay ?? 0 });
    }

    describe("given an active pull-mode source at worker start", () => {
      describe("when the seeder runs", () => {
        /** @scenario "A pull-mode source is seeded onto the event-sourcing queue at worker start" */
        it("stages exactly one ingestion-pull job for the source", async () => {
          const sourceId = await createSource();

          await seedIngestionPullers();

          expect(await pendingPullCount(sourceId)).toBe(1);
        });

        /** @scenario "Seeding is idempotent across restarts and duplicate calls" */
        it("keeps exactly one pending job when the seeder runs again", async () => {
          const sourceId = await createSource();

          await seedIngestionPullers();
          await seedIngestionPullers();

          expect(await pendingPullCount(sourceId)).toBe(1);
        });
      });
    });

    describe("given a source created with a schedule", () => {
      describe("when the create path arms the pull", () => {
        /** @scenario "Saving a source with a schedule seeds it immediately" */
        it("stages a pull without waiting for a worker restart", async () => {
          const sourceId = await createSource({ pullSchedule: "*/10 * * * *" });

          await armIngestionPullForSource({
            id: sourceId,
            pullSchedule: "*/10 * * * *",
            organizationId,
          });

          expect(await pendingPullCount(sourceId)).toBe(1);
        });
      });
    });

    describe("given a due ingestion-pull job", () => {
      describe("when it is processed", () => {
        /** @scenario "Each pull re-arms the next pull at the cron expression's next fire time, before doing the work" */
        it("stages the next pull before running the pull body", async () => {
          const sourceId = await createSource();
          let release!: () => void;
          control.gate = new Promise<void>((resolve) => {
            release = resolve;
          });

          await send(sourceId, { delay: 0 });

          // Wait until the pull body has been entered. Re-arm happens first, so
          // by the time runOnce is in flight the next pull must already be staged.
          await vi.waitFor(() => expect(control.calls).toBe(1), {
            timeout: 8000,
            interval: 50,
          });
          expect(await pendingPullCount(sourceId)).toBe(1);

          release();

          // The body completes and advances the cursor.
          await vi.waitFor(
            async () => {
              const row = await prisma.ingestionSource.findUnique({
                where: { id: sourceId },
                select: { pollerCursor: true },
              });
              expect(row?.pollerCursor).toBe("advanced");
            },
            { timeout: 8000, interval: 50 },
          );
        });
      });
    });

    describe("given a pull body slower than the gap to the next fire", () => {
      describe("when a second pull becomes due while one is running", () => {
        /** @scenario "Per-source serialization prevents overlapping pulls" */
        it("runs the pulls one at a time for the same source", async () => {
          const sourceId = await createSource();
          let release!: () => void;
          control.gate = new Promise<void>((resolve) => {
            release = resolve;
          });

          // Two due jobs for the same source. The group key serializes them, so
          // the second waits for the first to finish before its body runs.
          await send(sourceId, { delay: 0 });
          await send(sourceId, { delay: 0 });

          await vi.waitFor(() => expect(control.calls).toBe(1), {
            timeout: 8000,
            interval: 50,
          });
          // Give the queue room to (incorrectly) start the second one.
          await new Promise((r) => setTimeout(r, 300));
          expect(control.inFlight).toBe(1);

          release();

          await vi.waitFor(() => expect(control.calls).toBe(2), {
            timeout: 8000,
            interval: 50,
          });
          expect(control.maxInFlight).toBe(1);
        });
      });
    });

    describe("given an archived source", () => {
      describe("when its in-flight ingestion-pull job is processed", () => {
        /** @scenario "Archiving or disabling a source stops the recurrence" */
        it("does not run the pull body and stages no follow-up", async () => {
          const sourceId = await createSource({ archivedAt: new Date() });

          await send(sourceId, { delay: 0 });

          // The job dispatches and is consumed, leaving the staging set empty.
          await vi.waitFor(
            async () => expect(await pendingPullCount(sourceId)).toBe(0),
            { timeout: 8000, interval: 50 },
          );
          await new Promise((r) => setTimeout(r, 300));

          expect(control.calls).toBe(0);
          expect(await pendingPullCount(sourceId)).toBe(0);
        });
      });
    });
  },
);
