import {
  createEventSourcingService,
  createRegistry,
  type HandlerContext,
  memoryEventLog,
  memoryOutbox,
  memoryProcessStore,
  memoryQueue,
  memorySpool,
  type ReplaceStore,
  type StateRead,
  type StoredState,
  systemClock,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";

import { createIngestionPullProcessingPipeline } from "..";
import { INGESTION_PULL_PROCESS_NAME } from "../process-manager/ingestionPullProcess.types";
import type { IngestionPullRunStatusData } from "../projections/ingestionPullRunStatus.projection";
import type { IngestionPullRunCompletedData } from "../schemas/events";

/** A real, total store — nothing here is a stub with a green typecheck. */
function memoryReplaceStore<State>(): ReplaceStore<State> {
  const rows = new Map<string, StoredState<State>>();
  return {
    kind: "replace",
    async read(key): Promise<StateRead<State>> {
      const stored = rows.get(key);
      return stored ? { kind: "found", stored } : { kind: "absent" };
    },
    async write(key, stored) {
      rows.set(key, stored);
    },
  };
}

const ctx: HandlerContext = { now: 200, tenantId: "gov-project" };

const intent = {
  sourceId: "source-1",
  runId: "run-1",
  scheduledFor: 100,
  cursor: "cursor-1",
};

/**
 * Builds and registers the real pipeline on a real registry, then hands back
 * the `run` intent the outbox worker delivers — the same object the runtime
 * mounts, with its outcome commands bound through the shared command client
 * before the pipeline itself has registered.
 */
function registerPipeline({
  run,
}: {
  run: (params: {
    sourceId: string;
    cursor: string | null;
  }) => Promise<{ nextCursor: string | null; eventCount: number }>;
}) {
  const clock = systemClock();
  const spool = memorySpool();
  const eventLog = memoryEventLog();
  const registry = createRegistry();
  const service = createEventSourcingService({
    ports: {
      eventLog,
      queue: memoryQueue(clock),
      spool,
      processStore: memoryProcessStore(),
      outbox: memoryOutbox(clock),
      clock,
    },
    registry,
  });

  // The outcome commands are named INSIDE the factory, before the pipeline
  // exists — the client resolves them by name at send time.
  const pipeline = createIngestionPullProcessingPipeline({
    runStatusStore: memoryReplaceStore<IngestionPullRunStatusData>(),
    runPort: { run },
    commands: {
      recordRunCompleted: (input, sendCtx) =>
        service.commands.send("recordRunCompleted", input, sendCtx),
      recordRunFailed: (input, sendCtx) =>
        service.commands.send("recordRunFailed", input, sendCtx),
    },
  });
  service.register(pipeline);

  const runIntent =
    pipeline.processManagers[INGESTION_PULL_PROCESS_NAME]?.intents.run;

  return { eventLog, runIntent };
}

describe("ingestion_pull self-dispatch", () => {
  describe("when the pipeline names commands it registers itself", () => {
    /** @scenario A pipeline dispatching into its own command needs no late binding */
    it("commits run_completed through the shared command client", async () => {
      const { eventLog, runIntent } = registerPipeline({
        run: async () => ({ nextCursor: "cursor-2", eventCount: 3 }),
      });

      await runIntent?.deliver(intent, ctx);

      expect(eventLog.rows).toHaveLength(1);
      const row = eventLog.rows[0];
      expect(row?.eventType).toBe("lw.obs.ingestion_pull.run_completed");
      expect(row?.aggregateType).toBe("ingestion_pull");
      expect(row?.aggregateId).toBe("source-1");
      expect(row?.tenantId).toBe("gov-project");
      expect(JSON.parse(row?.payload ?? "{}")).toMatchObject({
        sourceId: "source-1",
        runId: "run-1",
        nextCursor: "cursor-2",
        eventCount: 3,
      } satisfies Partial<IngestionPullRunCompletedData>);
    });

    it("commits run_failed when the provider is down", async () => {
      const { eventLog, runIntent } = registerPipeline({
        run: () => Promise.reject(new Error("provider down")),
      });

      await runIntent?.deliver(intent, ctx);

      expect(eventLog.rows).toHaveLength(1);
      expect(eventLog.rows[0]?.eventType).toBe(
        "lw.obs.ingestion_pull.run_failed",
      );
      expect(JSON.parse(eventLog.rows[0]?.payload ?? "{}")).toMatchObject({
        sourceId: "source-1",
        runId: "run-1",
        error: "provider down",
        errorCode: "pull_failed",
        retryable: false,
      });
    });
  });
});
