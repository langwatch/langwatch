import { describe, expect, it, vi } from "vitest";

import {
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import type { TopicClusteringProcessingEvent } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

import { createTopicClusteringIntentHandlers } from "../topicClusteringEffects";
import {
  toTopicClusteringProcessEnvelope,
  topicClusteringProcessDefinition,
} from "../topicClusteringProcess.definition";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "../topicClusteringProcess.types";

const PROJECT_ID = "project-1";
const REF = {
  processName: TOPIC_CLUSTERING_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: PROJECT_ID,
};

function makeEvent(overrides: {
  type: TopicClusteringProcessingEvent["type"];
  id?: string;
  occurredAt?: number;
  data: unknown;
}): TopicClusteringProcessingEvent {
  return {
    id: overrides.id ?? `evt-${overrides.type}-${overrides.occurredAt ?? 1}`,
    aggregateId: PROJECT_ID,
    aggregateType: "topic_clustering",
    tenantId: PROJECT_ID,
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-07-17",
    ...overrides,
  } as TopicClusteringProcessingEvent;
}

function harness() {
  const store = new InMemoryProcessStore();
  const manager = new ProcessManagerService({
    definition: topicClusteringProcessDefinition,
    store,
  });
  return { store, manager };
}

async function bootstrap(
  manager: ProcessManagerService<unknown>,
  occurredAt = 10_000,
) {
  return manager.handleEvent({
    envelope: toTopicClusteringProcessEnvelope(
      makeEvent({
        type: "lw.obs.topic_clustering.requested",
        occurredAt,
        data: { trigger: "bootstrap" },
      }),
    ),
    now: occurredAt,
  });
}

describe("topic clustering process flow (store + manager + dispatcher)", () => {
  describe("when the daily wake fires for a bootstrapped project", () => {
    it("commits exactly one run intent to the durable outbox and reschedules", async () => {
      const { store, manager } = harness();
      await bootstrap(manager);

      const [wake] = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });
      expect(wake).toBeDefined();

      const result = await manager.handleWake({ wake: wake!, now: wake!.wakeAt });
      expect(result.outcome).toBe("committed");

      const messages = await store.findMessagesByRef({ ref: REF });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.status).toBe("pending");

      // The commit moved nextWakeAt ~24h forward, so the same wake is no
      // longer due — the schedule cannot double-fire a slot.
      const dueAgain = await store.findDueWakes({
        now: wake!.wakeAt + 1,
        limit: 10,
      });
      expect(dueAgain).toHaveLength(0);
    });
  });

  describe("when a stale wake races a newer commit", () => {
    it("stands down without touching state or the outbox", async () => {
      const { store, manager } = harness();
      await bootstrap(manager);
      const [wake] = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });

      // A manual request advances the revision before the wake is handled.
      await manager.handleEvent({
        envelope: toTopicClusteringProcessEnvelope(
          makeEvent({
            type: "lw.obs.topic_clustering.requested",
            occurredAt: 20_000,
            data: { trigger: "manual" },
          }),
        ),
        now: 20_000,
      });
      const messagesBefore = await store.findMessagesByRef({ ref: REF });

      const result = await manager.handleWake({ wake: wake!, now: wake!.wakeAt });

      expect(result.outcome).toBe("staleWake");
      const messagesAfter = await store.findMessagesByRef({ ref: REF });
      expect(messagesAfter).toHaveLength(messagesBefore.length);
    });
  });

  describe("when the same committed event is delivered twice", () => {
    it("consumes it once and inserts no duplicate intent", async () => {
      const { store, manager } = harness();
      await bootstrap(manager);

      const event = makeEvent({
        type: "lw.obs.topic_clustering.requested",
        id: "evt-manual-1",
        occurredAt: 20_000,
        data: { trigger: "manual" },
      });
      const first = await manager.handleEvent({
        envelope: toTopicClusteringProcessEnvelope(event),
        now: 20_000,
      });
      const second = await manager.handleEvent({
        envelope: toTopicClusteringProcessEnvelope(event),
        now: 20_001,
      });

      expect(first.outcome).toBe("committed");
      expect(second.outcome).toBe("duplicateEvent");
      const messages = await store.findMessagesByRef({ ref: REF });
      expect(messages).toHaveLength(1);
    });
  });

  describe("when the dispatcher runs a leased clustering intent", () => {
    it("executes the page and the completion event drives the continuation intent", async () => {
      const { store, manager } = harness();
      await bootstrap(manager);
      const [wake] = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });
      await manager.handleWake({ wake: wake!, now: wake!.wakeAt });

      const recordedStarts: unknown[] = [];
      const recordedCompletions: unknown[] = [];
      const dispatcher = new OutboxDispatcherService({
        store,
        handlers: createTopicClusteringIntentHandlers({
          runPort: {
            runClusteringPage: vi.fn().mockResolvedValue({
              mode: "batch",
              tracesProcessed: 2_000,
              topicsCount: 5,
              subtopicsCount: 12,
              nextSearchAfter: [wake!.wakeAt - 1, "trace-x"],
            }),
          },
          commands: {
            // This object must satisfy the FULL TopicClusteringOutcomeCommands
            // contract. It once omitted recordClusteringRunStarted; the
            // handler's best-effort try/catch swallowed the resulting
            // TypeError, so the test passed green while exercising the
            // "announcement failed" path on every dispatch.
            recordClusteringRunStarted: async (args) => {
              recordedStarts.push(args);
            },
            recordClusteringRunCompleted: async (args) => {
              recordedCompletions.push(args);
            },
            recordClusteringRunFailed: async () => undefined,
          },
          clock: () => wake!.wakeAt + 60_000,
        }),
        processNames: [TOPIC_CLUSTERING_PROCESS_NAME],
      });

      const report = await dispatcher.runOnce({ now: wake!.wakeAt + 1 });
      expect(report.dispatched).toHaveLength(1);
      // The page is announced before it is worked, so "run in progress" is a
      // recorded fact even for a single-page run.
      expect(recordedStarts).toHaveLength(1);
      expect(recordedStarts[0]).toMatchObject({ page: 1 });
      expect(recordedCompletions).toHaveLength(1);

      // In production the command becomes a run_completed event the
      // subscriber feeds back; simulate that committed event.
      const completion = recordedCompletions[0] as {
        runId: string;
        page: number;
        nextSearchAfter: [number, string];
      };
      await manager.handleEvent({
        envelope: toTopicClusteringProcessEnvelope(
          makeEvent({
            type: "lw.obs.topic_clustering.run_completed",
            occurredAt: wake!.wakeAt + 60_000,
            data: {
              runId: completion.runId,
              page: completion.page,
              mode: "batch",
              tracesProcessed: 2_000,
              topicsCount: 5,
              subtopicsCount: 12,
              nextSearchAfter: completion.nextSearchAfter,
            },
          }),
        ),
        now: wake!.wakeAt + 60_000,
      });

      const messages = await store.findMessagesByRef({ ref: REF });
      const pending = messages.filter((m) => m.status === "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.messageKey).toBe(`run:${completion.runId}:page-2`);
      expect(pending[0]!.payload).toMatchObject({
        page: 2,
        searchAfter: completion.nextSearchAfter,
      });
    });
  });

  describe("when a dispatcher from another domain scans the shared outbox", () => {
    it("cannot lease topic clustering intents", async () => {
      const { store, manager } = harness();
      await bootstrap(manager);
      const [wake] = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });
      await manager.handleWake({ wake: wake!, now: wake!.wakeAt });

      const leased = await store.leaseDueMessages({
        now: wake!.wakeAt + 1,
        limit: 10,
        leaseDurationMs: 30_000,
        processNames: ["langyConversation"],
      });

      expect(leased).toHaveLength(0);
    });
  });
});
