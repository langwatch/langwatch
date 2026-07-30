import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "~/server/event-sourcing.old/domain/types";
import { EventSourcing } from "~/server/event-sourcing.old/eventSourcing";
import type { IntentContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing.old/projections/stateProjection.types";
import { createMockEventStore } from "~/server/event-sourcing.old/services/__tests__/testHelpers";

import { createIngestionPullProcessingPipeline } from "../pipeline";
import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullRunIntent,
} from "../process-manager/ingestionPullProcess.types";
import type { IngestionPullRunStatusData } from "../projections/ingestionPullRunStatus.foldProjection";

/** A real, total store — nothing here is a stub with a green typecheck. */
function memoryStateStore<State>(): StateProjectionStore<State> {
  const rows = new Map<string, StoredProjection<State>>();
  return {
    async load(key) {
      return rows.get(key) ?? null;
    },
    async store(projection, context) {
      rows.set(context.key ?? context.aggregateId, projection);
    },
  };
}

function mockGlobalQueue() {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

const intent: IngestionPullRunIntent = {
  sourceId: "source-1",
  runId: "run-1",
  scheduledFor: 100,
  cursor: "cursor-1",
};

const context = (attempt: number): IntentContext => ({
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "gov-project",
  processKey: "source-1",
  tenantId: "gov-project",
  messageKey: "process:source-1:pull:run-1",
  attempt,
});

/**
 * Builds and registers the real pipeline, then hands back the `run` intent
 * executor the outbox dispatches into — the same object the runtime mounts,
 * with its outcome commands bound through the bus mid-`.build()`.
 */
function registerPipeline({
  run,
}: {
  run: (params: {
    sourceId: string;
    cursor: string | null;
  }) => Promise<{ nextCursor: string | null; eventCount: number }>;
}) {
  const queue = mockGlobalQueue();
  const es = EventSourcing.createForTesting({
    eventStore: createMockEventStore<Event>(),
    globalQueue: queue,
  });

  // The ports are bound INSIDE the factory, before the pipeline exists.
  const definition = createIngestionPullProcessingPipeline({
    runStatusStore: memoryStateStore<IngestionPullRunStatusData>(),
    runPort: { run },
    commands: es.commandBus,
  });
  es.register(definition);

  const executor = definition.processManagers.get(INGESTION_PULL_PROCESS_NAME)
    ?.config.intents[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]?.run;

  return { es, queue, executor };
}

describe("ingestion_pull_processing self-dispatch", () => {
  beforeEach(() => {
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("when the pipeline binds ports for commands it registers itself", () => {
    /** @scenario A pipeline dispatching into its own command needs no late binding */
    it("dispatches recordRunCompleted through the bus onto its own queue", async () => {
      const { es, queue, executor } = registerPipeline({
        run: async () => ({ nextCursor: "cursor-2", eventCount: 3 }),
      });

      // The whole registration completed with the ports already bound, which
      // is the case the hand-rolled thunk needed a resolve step for.
      expect(() => es.commandBus.assertPortsResolvable()).not.toThrow();

      await executor?.(intent, context(1));

      expect(queue.send).toHaveBeenCalledTimes(1);
      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        __pipelineName: "ingestion_pull_processing",
        __jobName: "recordRunCompleted",
        tenantId: "gov-project",
        sourceId: "source-1",
        runId: "run-1",
        nextCursor: "cursor-2",
        eventCount: 3,
      });
    });

    it("dispatches recordRunFailed through the bus on the final attempt", async () => {
      const { queue, executor } = registerPipeline({
        run: () => Promise.reject(new Error("provider down")),
      });

      await executor?.(intent, context(3));

      expect(queue.send).toHaveBeenCalledTimes(1);
      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        __pipelineName: "ingestion_pull_processing",
        __jobName: "recordRunFailed",
        sourceId: "source-1",
        runId: "run-1",
        error: "provider down",
        errorCode: "pull_failed",
        retryable: false,
      });
    });
  });
});
