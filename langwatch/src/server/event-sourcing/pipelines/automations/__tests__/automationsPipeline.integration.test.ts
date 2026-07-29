import { TriggerAction } from "@prisma/client";
import type { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import {
  cleanupTestDataForTenant,
  getTenantIdString,
} from "../../../__tests__/integration/testHelpers";
import { createTenantId } from "../../../domain/tenantId";
import { EventSourcing } from "../../../eventSourcing";
import { mapCommands } from "../../../mapCommands";
import { InMemoryProcessStore } from "../../../process-manager/stores/inMemoryProcessStore";
import {
  type AutomationsPipelineDeps,
  createAutomationsPipeline,
} from "../pipeline";
import type { SettlementState } from "../process-manager/triggerSettlement.process";
import type { TriggerSettlementDispatchDeps } from "../process-manager/triggerSettlementIntentHandlers";
import { TRIGGER_MATCH_COALESCE_MAX_BATCH } from "../schemas/constants";
import type { AutomationEvent } from "../schemas/events";

const tenantId = createTenantId("project-1");

// The REAL inline pipeline topology (ADR-052) with inert executor deps —
// intent executors never run in these tests (no wake worker), so the
// dispatch surface can stay empty.
const pipelineDeps = (): AutomationsPipelineDeps => ({
  dispatch: {} as TriggerSettlementDispatchDeps,
  sweep: {
    decideSweepCandidates: vi.fn().mockResolvedValue([]),
    evaluateGraphTrigger: vi.fn().mockResolvedValue(undefined),
    deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
  },
  prune: {
    pruneExpired: vi.fn().mockResolvedValue(0),
    deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
  },
});

const command = (
  traceId: string,
  occurredAt: number,
  triggerId = "trigger-1",
) => ({
  tenantId,
  occurredAt,
  triggerId,
  traceId,
  action: TriggerAction.SEND_EMAIL,
  actionClass: "notify" as const,
  traceDebounceMs: 30_000,
  notificationCadence: "immediate" as const,
});

describe("automations pipeline", () => {
  let eventSourcing: EventSourcing | undefined;

  afterEach(async () => {
    await eventSourcing?.close();
  });

  describe("given a trigger-match command is redelivered", () => {
    describe("when both physical events reach the process inbox", () => {
      it("records one logical event and consumes the match once", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline(pipelineDeps()),
        );
        const commands = mapCommands(pipeline.commands);

        const redeliveredCommand = command("trace-1", 1_000);
        await commands.recordTriggerMatch(redeliveredCommand);
        await commands.recordTriggerMatch(redeliveredCommand);

        const events = await eventSourcing
          .getEventStore<AutomationEvent>()!
          .getEvents("trigger-1", { tenantId }, "trigger");
        const process = await processStore.findByRef<SettlementState>({
          ref: {
            processName: "triggerSettlement",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        });

        expect(events).toHaveLength(1);
        expect(events[0]?.idempotencyKey).toBe("trigger-1:trace-1:30000-0");
        expect(Object.keys(process?.state.pendingMatches ?? {})).toEqual([
          "trace-1",
        ]);
      });
    });
  });

  describe("given a settled trigger and trace receive later activity", () => {
    describe("when the later activity lands in a new settle window", () => {
      it("records and consumes a second evaluation round", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline(pipelineDeps()),
        );
        const commands = mapCommands(pipeline.commands);

        await commands.recordTriggerMatch(command("trace-1", 1_000));
        await commands.recordTriggerMatch(command("trace-1", 31_000));

        const events = await eventSourcing
          .getEventStore<AutomationEvent>()!
          .getEvents("trigger-1", { tenantId }, "trigger");
        const process = await processStore.findByRef<SettlementState>({
          ref: {
            processName: "triggerSettlement",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        });

        expect(events.map((event) => event.idempotencyKey)).toEqual([
          "trigger-1:trace-1:30000-0",
          "trigger-1:trace-1:30000-1",
        ]);
        // The second round re-armed the same trace in the later window.
        expect(
          process?.state.pendingMatches["trace-1"]?.settleWindowBucket,
        ).toBe("30000-1");
      });
    });
  });

  // ADR-066 pillar 2: recordTriggerMatch opts into append coalescing. This suite
  // runs on the in-memory queue (redis: null), which processes one job at a time
  // and does NOT coalesce — so the "N matches → fewer inserts" observable is
  // proven end-to-end at the GroupQueue layer (groupQueue.integration.test.ts,
  // scripts.integration.test.ts). Here we pin the adopter's opt-in and confirm
  // the config leaves every match durably recorded and in FIFO order.
  describe("given several matches for one trigger", () => {
    describe("when coalescing is configured on the producer", () => {
      it("registers recordTriggerMatch with append coalescing enabled", () => {
        const builtPipeline = createAutomationsPipeline(pipelineDeps());
        const recordMatch = builtPipeline.commands.find(
          (c) => c.name === "recordTriggerMatch",
        );

        expect(recordMatch?.options?.coalesceMaxBatch).toBe(
          TRIGGER_MATCH_COALESCE_MAX_BATCH,
        );
        expect(recordMatch?.options?.serializeByAggregate).toBe(true);
      });

      it("records every match durably in FIFO order", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline(pipelineDeps()),
        );
        const commands = mapCommands(pipeline.commands);

        await commands.recordTriggerMatch(command("trace-1", 1_000));
        await commands.recordTriggerMatch(command("trace-2", 2_000));
        await commands.recordTriggerMatch(command("trace-3", 3_000));

        const events = await eventSourcing
          .getEventStore<AutomationEvent>()!
          .getEvents("trigger-1", { tenantId }, "trigger");

        expect(events.map((event) => event.idempotencyKey)).toEqual([
          "trigger-1:trace-1:30000-0",
          "trigger-1:trace-2:30000-0",
          "trigger-1:trace-3:30000-0",
        ]);
      });
    });

    describe("when commands and committed events are delivered", () => {
      it("keeps FIFO ordering through the trigger process", async () => {
        const processStore = new InMemoryProcessStore();
        eventSourcing = new EventSourcing({ processStore, redis: null });
        const pipeline = eventSourcing.register(
          createAutomationsPipeline(pipelineDeps()),
        );
        const commands = mapCommands(pipeline.commands);

        await commands.recordTriggerMatch(command("trace-1", 1_000));
        await commands.recordTriggerMatch(command("trace-2", 2_000));
        await commands.recordTriggerMatch(command("trace-3", 3_000));

        const process = await processStore.findByRef<SettlementState>({
          ref: {
            processName: "triggerSettlement",
            projectId: tenantId,
            processKey: "trigger-1",
          },
        });

        expect(Object.keys(process?.state.pendingMatches ?? {})).toEqual([
          "trace-1",
          "trace-2",
          "trace-3",
        ]);
      });
    });
  });

  describe("given two triggers in one project match the same trace", () => {
    it("keeps their process-outbox identities isolated", async () => {
      const processStore = new InMemoryProcessStore();
      eventSourcing = new EventSourcing({ processStore, redis: null });
      const pipeline = eventSourcing.register(
        createAutomationsPipeline(pipelineDeps()),
      );
      const commands = mapCommands(pipeline.commands);

      await commands.recordTriggerMatch(command("trace-1", 1_000, "trigger-1"));
      await commands.recordTriggerMatch(command("trace-1", 2_000, "trigger-2"));

      const processes = await Promise.all(
        ["trigger-1", "trigger-2"].map((processKey) =>
          processStore.findByRef<SettlementState>({
            ref: {
              processName: "triggerSettlement",
              projectId: tenantId,
              processKey,
            },
          }),
        ),
      );

      // Each trigger owns its own process instance; the shared trace lands
      // in both pending sets without cross-talk.
      expect(
        processes.map((process) =>
          Object.keys(process?.state.pendingMatches ?? {}),
        ),
      ).toEqual([["trace-1"], ["trace-1"]]);
    });
  });
});

// ADR-066 pillar 2 — the redis:null suites above never coalesce (the in-memory
// queue processes one job at a time), so the coalesced processCommandBatch path
// through the REAL recordTriggerMatch handler stays unexercised there. This suite
// runs a redis-backed GroupQueue with the coalescing consumer live and proves the
// end-to-end observable: several matches for one trigger collapse into one
// multi-row event-store write, every match's distinct idempotency key preserved.
const hasRedis = !!(process.env.REDIS_URL || process.env.CI_REDIS_URL);

describe.skipIf(!hasRedis)(
  "automations pipeline — coalesced redis-backed dispatch",
  () => {
    let redis: Redis;

    beforeAll(async () => {
      await startTestContainers();
      redis = getTestRedisConnection()!;
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    afterEach(async () => {
      // Tenant-scoped cleanup, not redis.flushall(): flushall bypasses tenant
      // isolation and races other parallel suites on the shared test redis. The
      // GroupQueue's own keys are torn down by eventSourcing.close() in the test
      // body's finally; this drops any per-tenant rows left behind.
      await cleanupTestDataForTenant(getTenantIdString(tenantId));
    });

    describe("given several matches for one trigger staged as a batch", () => {
      describe("when the coalescing consumer drains them", () => {
        it("stores every match in one multi-row call with distinct idempotency keys", async () => {
          const processStore = new InMemoryProcessStore();
          // processRole "all" runs the worker so the GroupQueue consumer actually
          // drains and coalesces; no clickhouse → the in-memory event store backs
          // reads, and we spy on its multi-row write.
          const eventSourcing = new EventSourcing({
            processStore,
            redis,
            processRole: "all",
          });

          try {
            const pipeline = eventSourcing.register(
              createAutomationsPipeline(pipelineDeps()),
            );
            const commands = mapCommands(pipeline.commands);

            const eventStore = eventSourcing.getEventStore<AutomationEvent>()!;
            const storeSpy = vi.spyOn(eventStore, "storeEvents");

            // sendBatch stages all three atomically in one group, so the drain
            // folds them into a single processCommandBatch call. Per-command
            // sends would race the consumer and might never coalesce.
            await commands.recordTriggerMatch.sendBatch!([
              command("trace-1", 1_000),
              command("trace-2", 2_000),
              command("trace-3", 3_000),
            ]);

            await vi.waitFor(
              async () => {
                const events = await eventStore.getEvents(
                  "trigger-1",
                  { tenantId },
                  "trigger",
                );
                expect(events).toHaveLength(3);
              },
              { timeout: 15_000, interval: 50 },
            );

            // One multi-row store call carried all three matches — the coalesced
            // path collapsed three single-row appends into one insert.
            const multiRowCalls = storeSpy.mock.calls.filter(
              ([events]) => (events as readonly AutomationEvent[]).length > 1,
            );
            expect(multiRowCalls).toHaveLength(1);
            const [batchedEvents] = multiRowCalls[0]!;
            expect(
              (batchedEvents as readonly AutomationEvent[]).map(
                (event) => event.idempotencyKey,
              ),
            ).toEqual([
              "trigger-1:trace-1:30000-0",
              "trigger-1:trace-2:30000-0",
              "trigger-1:trace-3:30000-0",
            ]);
          } finally {
            await eventSourcing.close();
          }
        });
      });
    });
  },
);
