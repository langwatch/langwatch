// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { UNLIMITED_PLAN } from "@ee/licensing/constants";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
/**
 * Integration coverage for calendar-scheduled ingestion pulls against a REAL
 * Postgres (`ScheduledJob` rows) + a REAL GroupQueue (Redis). Proves the
 * calendar row lifecycle (create / reschedule / deactivate / reactivate /
 * boot reconcile), the fire handler's enqueue-and-return contract, and the
 * execution properties the GroupQueue owns (per-source serialization,
 * bounded global concurrency) — no BullMQ, no Linux cron, no self-re-arm.
 *
 * Spec: specs/ai-governance/puller-framework/calendar-scheduled-pulls.feature
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
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
import { IngestionSourceService } from "../../activity-monitor/ingestionSource.service";
import { ensureHiddenGovernanceProject } from "../../governanceProject.service";

import {
  handleIngestionPullFire,
  INGESTION_PULL_TARGET_TYPE,
  type IngestionPullPayload,
  PULL_CONCURRENCY_LIMIT,
  reconcileIngestionPullSchedules,
  registerIngestionPullJob,
  syncIngestionPullSchedule,
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
  "ingestionPullScheduler — calendar-scheduled pulls end-to-end",
  () => {
    let redis: Redis;
    let eventSourcing: EventSourcing;
    let pullJob: ReturnType<typeof registerIngestionPullJob>;
    let organizationId: string;
    let govProjectId: string;
    let actorUserId: string;
    const createdSourceIds: string[] = [];

    beforeAll(async () => {
      await startTestContainers();
      await resetApp();
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: async () => UNLIMITED_PLAN,
        }),
      });
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
      // then register the pull execution job on it (the same call
      // pipelineRegistry makes in production).
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

      await prisma.team.create({
        data: {
          name: `pull-sched team ${nanoid(6)}`,
          slug: `--pull-sched-team-${nanoid(8)}`,
          organizationId,
        },
      });
      const actor = await prisma.user.create({
        data: {
          name: "Pull scheduler test actor",
          email: `pull-sched-${nanoid(8)}@example.com`,
        },
      });
      actorUserId = actor.id;

      // The calendar rows live under the org's hidden governance project.
      govProjectId = (await ensureHiddenGovernanceProject(prisma, organizationId))
        .id;
    });

    beforeEach(() => {
      control = freshControl();
    });

    // Per-source cleanup: every test creates sources with unique ids, so
    // deleting only those sources' event-sourcing keys (group ZSET, data,
    // dedup) and calendar rows isolates tests without a global FLUSHALL and
    // without matching any key from another test or tenant.
    afterEach(async () => {
      for (const id of createdSourceIds) {
        const keys = await redis.keys(`*${id}*`);
        if (keys.length > 0) await redis.del(...keys);
      }
      await prisma.scheduledJob.deleteMany({
        where: {
          projectId: govProjectId,
          targetType: INGESTION_PULL_TARGET_TYPE,
          targetId: { in: createdSourceIds },
        },
      });
      await prisma.ingestionSource.deleteMany({
        where: { id: { in: createdSourceIds } },
      });
      createdSourceIds.length = 0;
    });

    afterAll(async () => {
      await resetApp();
      await eventSourcing.close().catch(() => {});
      await prisma.scheduledJob.deleteMany({
        where: { projectId: govProjectId },
      });
      await prisma.ingestionSource.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({
        where: { team: { organizationId } },
      });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
      await prisma.user.delete({ where: { id: actorUserId } });
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
      createdSourceIds.push(source.id);
      return source.id;
    }

    async function calendarRow(sourceId: string) {
      return prisma.scheduledJob.findFirst({
        where: {
          projectId: govProjectId,
          targetType: INGESTION_PULL_TARGET_TYPE,
          targetId: sourceId,
        },
      });
    }

    async function calendarRowCount(sourceId: string): Promise<number> {
      return prisma.scheduledJob.count({
        where: {
          projectId: govProjectId,
          targetType: INGESTION_PULL_TARGET_TYPE,
          targetId: sourceId,
        },
      });
    }

    function fireFor(sourceId: string) {
      return {
        projectId: govProjectId,
        targetType: INGESTION_PULL_TARGET_TYPE,
        targetId: sourceId,
        slot: new Date(),
      };
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

    describe("given a source created with a schedule", () => {
      describe("when the create mutation succeeds", () => {
        /** @scenario "Saving a source with a schedule creates its calendar entry" */
        it("creates an active ScheduledJob row with the cron's next fire", async () => {
          const { source } = await IngestionSourceService.create(
            prisma,
          ).createSource({
            organizationId,
            sourceType: "claude_compliance",
            name: `service-created-pull-source-${nanoid(8)}`,
            parserConfig: { adapter: FIXTURE_ADAPTER_ID },
            pullSchedule: "*/10 * * * *",
            actorUserId,
          });
          createdSourceIds.push(source.id);

          const row = await calendarRow(source.id);
          expect(row).not.toBeNull();
          expect(row!.active).toBe(true);
          expect(row!.cron).toBe("*/10 * * * *");
          expect(row!.timezone).toBe("UTC");
          // The next fire is a real */10 boundary in the future.
          expect(row!.nextRunAt.getTime()).toBeGreaterThan(Date.now() - 1000);
          expect(row!.nextRunAt.getUTCMinutes() % 10).toBe(0);
          expect(row!.nextRunAt.getUTCSeconds()).toBe(0);

          // No BullMQ queue backs ingestion pulls.
          const bullKeys = await redis.keys("bull:*puller*");
          expect(bullKeys).toEqual([]);
        });
      });
    });

    describe("given an active pull-mode source with a schedule but no calendar row", () => {
      describe("when the boot-time reconcile pass runs", () => {
        /** @scenario "Worker boot repairs sources missing a calendar entry" */
        it("creates the missing row and leaves existing rows untouched", async () => {
          const sourceId = await createSource();
          expect(await calendarRow(sourceId)).toBeNull();

          await reconcileIngestionPullSchedules();

          const created = await calendarRow(sourceId);
          expect(created).not.toBeNull();
          expect(created!.active).toBe(true);

          // A row that disable/archive deactivated is NOT resurrected.
          await prisma.scheduledJob.update({
            where: { id: created!.id, projectId: govProjectId },
            data: { active: false },
          });
          await reconcileIngestionPullSchedules();
          const afterSecondPass = await calendarRow(sourceId);
          expect(afterSecondPass!.active).toBe(false);
          expect(await calendarRowCount(sourceId)).toBe(1);
        });
      });
    });

    describe("given an active source with a calendar row", () => {
      describe("when its pull schedule is updated", () => {
        /** @scenario "Updating the pull schedule reschedules the calendar entry" */
        it("keeps one row and moves its next fire to the new cron", async () => {
          const sourceId = await createSource({ pullSchedule: "0 0 1 1 *" });
          await syncIngestionPullSchedule({
            source: {
              id: sourceId,
              pullSchedule: "0 0 1 1 *",
              organizationId,
            },
          });
          const before = await calendarRow(sourceId);

          const source = await IngestionSourceService.create(
            prisma,
          ).updateSource({
            id: sourceId,
            organizationId,
            pullSchedule: "* * * * *",
          });

          expect(source.pullSchedule).toBe("* * * * *");
          expect(await calendarRowCount(sourceId)).toBe(1);
          const after = await calendarRow(sourceId);
          expect(after!.cron).toBe("* * * * *");
          expect(after!.nextRunAt.getTime()).toBeLessThan(
            before!.nextRunAt.getTime(),
          );
        });
      });

      describe("when an update supplies a malformed pull schedule", () => {
        /** @scenario "Malformed schedules are rejected without touching the calendar" */
        it("rejects the update and preserves the valid calendar row", async () => {
          const validSchedule = "0 0 1 1 *";
          const sourceId = await createSource({ pullSchedule: validSchedule });
          await syncIngestionPullSchedule({
            source: {
              id: sourceId,
              pullSchedule: validSchedule,
              organizationId,
            },
          });
          const before = await calendarRow(sourceId);

          await expect(
            IngestionSourceService.create(prisma).updateSource({
              id: sourceId,
              organizationId,
              pullSchedule: "definitely not cron",
            }),
          ).rejects.toThrow("Invalid pullSchedule cron expression");

          const source = await prisma.ingestionSource.findUniqueOrThrow({
            where: { id: sourceId },
            select: { pullSchedule: true },
          });
          expect(source.pullSchedule).toBe(validSchedule);
          const after = await calendarRow(sourceId);
          expect(after!.cron).toBe(validSchedule);
          expect(after!.nextRunAt.getTime()).toBe(before!.nextRunAt.getTime());
        });
      });

      describe("when the source is disabled or archived", () => {
        /** @scenario "Disabling or archiving a source deactivates its calendar entry" */
        it("deactivates the calendar row so the due-scan skips it", async () => {
          const service = IngestionSourceService.create(prisma);

          const disabledId = await createSource();
          await syncIngestionPullSchedule({
            source: {
              id: disabledId,
              pullSchedule: "*/15 * * * *",
              organizationId,
            },
          });
          await service.updateSource({
            id: disabledId,
            organizationId,
            status: "disabled",
          });
          expect((await calendarRow(disabledId))!.active).toBe(false);

          const archivedId = await createSource();
          await syncIngestionPullSchedule({
            source: {
              id: archivedId,
              pullSchedule: "*/15 * * * *",
              organizationId,
            },
          });
          await service.archive(archivedId, organizationId);
          expect((await calendarRow(archivedId))!.active).toBe(false);
        });
      });
    });

    describe("given a disabled source with a deactivated calendar row", () => {
      describe("when the source is re-enabled", () => {
        /** @scenario "Re-enabling a disabled source reactivates its calendar entry" */
        it("reactivates the row with a fresh next fire", async () => {
          const sourceId = await createSource({ status: "disabled" });
          await syncIngestionPullSchedule({
            source: {
              id: sourceId,
              pullSchedule: "*/15 * * * *",
              organizationId,
            },
          });
          await prisma.scheduledJob.updateMany({
            where: {
              projectId: govProjectId,
              targetType: INGESTION_PULL_TARGET_TYPE,
              targetId: sourceId,
            },
            data: { active: false },
          });

          await IngestionSourceService.create(prisma).updateSource({
            id: sourceId,
            organizationId,
            status: "active",
          });

          const row = await calendarRow(sourceId);
          expect(row!.active).toBe(true);
          expect(row!.nextRunAt.getTime()).toBeGreaterThan(Date.now() - 1000);
        });
      });
    });

    describe("given an active pull-mode source with a calendar row", () => {
      describe("when the source's calendar fire is handled", () => {
        /** @scenario "A due calendar fire enqueues the pull onto the event-sourcing queue" */
        it("stages the pull job and the queue runs the pull body", async () => {
          const sourceId = await createSource();
          let release!: () => void;
          control.gate = new Promise<void>((resolve) => {
            release = resolve;
          });

          await handleIngestionPullFire(fireFor(sourceId));

          // The handler returned after enqueueing; the pull body runs on the
          // queue's workers.
          await vi.waitFor(() => expect(control.calls).toBe(1), {
            timeout: 8000,
            interval: 50,
          });
          release();

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

    describe("given a source archived after its calendar row was created", () => {
      describe("when its calendar fire is handled", () => {
        /** @scenario "A fire for a source that is no longer schedulable stops the recurrence" */
        it("does not run the pull body and deactivates the calendar row", async () => {
          const sourceId = await createSource();
          await syncIngestionPullSchedule({
            source: {
              id: sourceId,
              pullSchedule: "*/15 * * * *",
              organizationId,
            },
          });
          await prisma.ingestionSource.update({
            where: { id: sourceId },
            data: { archivedAt: new Date(), status: "disabled" },
          });

          await handleIngestionPullFire(fireFor(sourceId));

          expect(await pendingPullCount(sourceId)).toBe(0);
          expect(control.calls).toBe(0);
          expect((await calendarRow(sourceId))!.active).toBe(false);
        });

        // ScheduledJob has no FK to the source, so a hard-deleted source
        // would otherwise leave an active orphan row re-firing every slot.
        it("deactivates the orphan row when the source no longer exists", async () => {
          const ghostSourceId = `ghost-${nanoid(8)}`;
          createdSourceIds.push(ghostSourceId);
          await prisma.scheduledJob.create({
            data: {
              projectId: govProjectId,
              targetType: INGESTION_PULL_TARGET_TYPE,
              targetId: ghostSourceId,
              cron: "*/15 * * * *",
              timezone: "UTC",
              nextRunAt: new Date(),
            },
          });

          await handleIngestionPullFire(fireFor(ghostSourceId));

          expect(control.calls).toBe(0);
          expect((await calendarRow(ghostSourceId))!.active).toBe(false);
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

          await send(sourceId, { delay: 0 });
          await vi.waitFor(() => expect(control.inFlight).toBe(1), {
            timeout: 8000,
            interval: 25,
          });

          // A second pull for the SAME source becomes due while the first is
          // still in flight: the group serializes, so it must not start.
          await send(sourceId, { delay: 0 });
          await new Promise((r) => setTimeout(r, 300));
          expect(control.maxInFlight).toBe(1);

          release();
          control.gate = null;

          await vi.waitFor(() => expect(control.calls).toBe(2), {
            timeout: 8000,
            interval: 50,
          });
          expect(control.maxInFlight).toBe(1);
        });
      });
    });

    describe("given more due pull-mode sources than the pull concurrency limit", () => {
      describe("when their ingestion-pull jobs all become due at once", () => {
        /** @scenario "Global pull concurrency is bounded across sources" */
        it("runs no more than the limit of pull bodies at the same time", async () => {
          const sourceCount = PULL_CONCURRENCY_LIMIT + 3;
          let release!: () => void;
          control.gate = new Promise<void>((resolve) => {
            release = resolve;
          });

          const ids: string[] = [];
          for (let index = 0; index < sourceCount; index += 1) {
            ids.push(await createSource());
          }

          // Every source is its own group, so the GroupQueue would run all of
          // them fully in parallel; only the puller bulkhead caps the fan-out.
          await Promise.all(ids.map((id) => send(id, { delay: 0 })));

          // Exactly the limit enters the gated body; the rest are deferred by
          // the saturation guard.
          await vi.waitFor(
            () => expect(control.inFlight).toBe(PULL_CONCURRENCY_LIMIT),
            { timeout: 15000, interval: 25 },
          );
          // Give the queue room to (incorrectly) admit more past the cap.
          await new Promise((r) => setTimeout(r, 400));
          expect(control.inFlight).toBe(PULL_CONCURRENCY_LIMIT);
          expect(control.maxInFlight).toBe(PULL_CONCURRENCY_LIMIT);

          release();

          // All sources eventually complete, never exceeding the cap.
          await vi.waitFor(() => expect(control.calls).toBe(sourceCount), {
            timeout: 15000,
            interval: 50,
          });
          expect(control.maxInFlight).toBe(PULL_CONCURRENCY_LIMIT);
        });
      });
    });
  },
);
