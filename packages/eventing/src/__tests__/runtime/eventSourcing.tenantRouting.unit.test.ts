import { NonRetryableGroupQueueError } from "@langwatch/group-queue";
/**
 * The consumer's tenant gate: a job whose payload tenant disagrees with its
 * group-key tenant segment was misrouted and must be refused — dead-lettered
 * via the queue's non-retryable failure path — before its handler runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventSourcing } from "../../eventSourcing.ts";
import type { EventSourcedQueueDefinition } from "../../queues/index.ts";
import { QueueTenantMismatchError } from "../../services/errorHandling.ts";
import type { JobRegistryEntry } from "../../services/queues/queueManager.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const captured: {
  definition?: EventSourcedQueueDefinition<Record<string, unknown>>;
} = {};

const ROUTING = {
  __pipelineName: "test_pipeline",
  __jobType: "map",
  __jobName: "testProjection",
} as const;

/**
 * An entry shaped like a QueueManager lane: `getTenantId` is the accessor the
 * group key was built with, `groupKeyFn` the hierarchical
 * `${tenantId}/${jobPath}/${domainKey}` key itself.
 */
const laneEntry = (overrides: Partial<JobRegistryEntry> = {}): JobRegistryEntry => ({
  process: vi.fn().mockResolvedValue(undefined),
  processBatch: vi.fn().mockResolvedValue(undefined),
  getTenantId: (payload: Record<string, unknown>) => String(payload.tenantId),
  groupKeyFn: (payload: Record<string, unknown>) =>
    `${String(payload.tenantId)}/map/testProjection/thing:x`,
  scoreFn: () => 0,
  ...overrides,
});

function createWithEntry(entry: JobRegistryEntry) {
  const eventSourcing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: (definition) => {
      captured.definition = definition;
      return {
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch: vi.fn().mockResolvedValue(undefined),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
    },
  });
  void eventSourcing.globalQueue;
  eventSourcing.globalJobRegistry.set(
    `${ROUTING.__pipelineName}:${ROUTING.__jobType}:${ROUTING.__jobName}`,
    entry,
  );
  return { eventSourcing, entry };
}

describe("the shared queue's tenant gate", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when the payload tenant matches the group-key tenant", () => {
    it("processes the job as today, with the clean payload", async () => {
      const { eventSourcing, entry } = createWithEntry(laneEntry());

      await captured.definition!.process(
        { ...ROUTING, tenantId: "tenant-a", value: "a" },
        { attempt: 1 },
      );

      expect(entry.process).toHaveBeenCalledWith(
        { tenantId: "tenant-a", value: "a" },
        { attempt: 1 },
      );
      await eventSourcing.close();
    });
  });

  describe("when the payload tenant contains a path separator", () => {
    it("refuses non-retryably — handler never runs, error classifies as dead-letter", async () => {
      // The queue derives a group's tenant from the key's first `/` segment;
      // a tenant id carrying its own separator stages the job under one
      // tenant's group while the payload claims another scope. The group-key
      // segment ("tenant-a") and the accessor ("tenant-a/extra") disagree.
      const { eventSourcing, entry } = createWithEntry(laneEntry());

      const failure = await captured
        .definition!.process({ ...ROUTING, tenantId: "tenant-a/extra", value: "a" }, { attempt: 1 })
        .then(() => null)
        .catch((error: unknown) => error);

      expect(entry.process).not.toHaveBeenCalled();
      expect(failure).toBeInstanceOf(QueueTenantMismatchError);
      expect(failure).toBeInstanceOf(NonRetryableGroupQueueError);
      // The property the group queue's failure classifier keys on: false
      // routes the job straight to the exhausted-retry dead-letter path
      // instead of 25 re-stages.
      expect((failure as NonRetryableGroupQueueError).retryable).toBe(false);
      await eventSourcing.close();
    });
  });

  describe("when the group key was staged under a different tenant than the payload carries", () => {
    it("refuses before the handler runs", async () => {
      // A lane whose group key resolves the tenant from a different field —
      // e.g. a reactor lane reading payload.event.tenantId — handed a payload
      // whose two tenant fields disagree: the group says tenant-b, the
      // recorded accessor says tenant-a.
      const reactorEntry = laneEntry({
        getTenantId: (payload: Record<string, unknown>) => String(payload.tenantId),
        groupKeyFn: (payload: Record<string, unknown>) => {
          const event = payload.event as { tenantId?: unknown } | undefined;
          return `${String(event?.tenantId)}/fold/proj/reactor/sub/x`;
        },
      });
      const { eventSourcing, entry } = createWithEntry(reactorEntry);

      const payload = {
        ...ROUTING,
        __jobType: "reactor",
        tenantId: "tenant-a",
        event: { tenantId: "tenant-b" },
      };
      eventSourcing.globalJobRegistry.set(
        `${ROUTING.__pipelineName}:reactor:${ROUTING.__jobName}`,
        reactorEntry,
      );

      await expect(captured.definition!.process(payload, { attempt: 1 })).rejects.toBeInstanceOf(
        QueueTenantMismatchError,
      );
      expect(entry.process).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });

  describe("when a coalesced batch carries a misrouted payload", () => {
    it("refuses the whole batch — the batch handler never runs", async () => {
      const { eventSourcing, entry } = createWithEntry(laneEntry());

      await expect(
        captured.definition!.processBatch!(
          [
            { ...ROUTING, tenantId: "tenant-a", value: "a" },
            { ...ROUTING, tenantId: "tenant-b/x", value: "b" },
          ],
          { attempt: 2 },
        ),
      ).rejects.toBeInstanceOf(QueueTenantMismatchError);
      expect(entry.processBatch).not.toHaveBeenCalled();
      expect(entry.process).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });

  describe("when a coalesced batch's tenants all match their group keys", () => {
    it("processes the batch as today", async () => {
      const { eventSourcing, entry } = createWithEntry(laneEntry());

      await captured.definition!.processBatch!(
        [
          { ...ROUTING, tenantId: "tenant-a", value: "a" },
          { ...ROUTING, tenantId: "tenant-a", value: "b" },
        ],
        { attempt: 2 },
      );

      expect(entry.processBatch).toHaveBeenCalledWith(
        [
          { tenantId: "tenant-a", value: "a" },
          { tenantId: "tenant-a", value: "b" },
        ],
        { attempt: 2 },
      );
      await eventSourcing.close();
    });
  });
});
