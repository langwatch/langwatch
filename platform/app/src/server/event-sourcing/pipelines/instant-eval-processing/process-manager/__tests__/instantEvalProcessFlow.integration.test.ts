/**
 * The whole run driven through the process store, the manager and the outbox
 * dispatcher, against the exact topology the pipeline mounts.
 *
 * Needs no datastore: the process store is in memory and the domain port is a
 * fake, which is what lets the loop itself be asserted rather than the
 * behaviour of a classifier.
 *
 * @see ../../pipeline.ts
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";
import { instantEvalPM } from "../../pipeline";
import { INSTANT_EVAL_EVENT_TYPES } from "../../schemas/constants";
import type { InstantEvalProcessingEvent } from "../../schemas/events";
import { buildProcessEventView } from "../instantEval.process";
import type {
  InstantEvalOutcomeCommands,
  InstantEvalPageOutcome,
  InstantEvalRunPort,
} from "../instantEvalIntentHandlers";
import {
  INSTANT_EVAL_PROCESS_NAME,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
} from "../instantEvalProcess.types";

const PROJECT_ID = "project-1";
const RUN_ID = "instanteval_1";
const REF = {
  processName: INSTANT_EVAL_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: RUN_ID,
};

function makeEvent(overrides: {
  type: InstantEvalProcessingEvent["type"];
  occurredAt?: number;
  data: Record<string, unknown>;
}): InstantEvalProcessingEvent {
  return {
    id: `evt-${overrides.type}-${overrides.occurredAt ?? 1_000}`,
    aggregateId: RUN_ID,
    aggregateType: "instant_eval_run",
    tenantId: PROJECT_ID,
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-09-18",
    ...overrides,
  } as InstantEvalProcessingEvent;
}

function toEnvelope(event: InstantEvalProcessingEvent) {
  return {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt,
    tenantId: String(event.tenantId),
    projectId: String(event.tenantId),
    processKey: String(event.aggregateId),
    payload: buildProcessEventView(event),
  };
}

/** Builder-authored intent keys are qualified per process instance. */
function key(suffix: string): string {
  return `process:${encodeURIComponent(RUN_ID)}:${suffix}`;
}

const page = (overrides: Partial<InstantEvalPageOutcome> = {}) =>
  ({
    rows: 500,
    matched: 10,
    matchedByQuestion: { annoyed: 10 },
    failed: 0,
    skipped: 0,
    inputTokens: 900,
    requests: 500,
    cursor: "t500",
    hasNextPage: true,
    ...overrides,
  }) satisfies InstantEvalPageOutcome;

/** Every command the executors call, so a partial fake cannot pass green. */
function commandSpies(): InstantEvalOutcomeCommands & {
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {
    recordPlanned: [],
    recordPageJudged: [],
    recordFinished: [],
  };
  return {
    calls,
    recordPlanned: async (args) => {
      calls.recordPlanned?.push(args);
    },
    recordPageJudged: async (args) => {
      calls.recordPageJudged?.push(args);
    },
    recordFinished: async (args) => {
      calls.recordFinished?.push(args);
    },
  };
}

function harness(runPort: Partial<InstantEvalRunPort> = {}) {
  const store = new InMemoryProcessStore();
  const commands = commandSpies();
  const port: InstantEvalRunPort = {
    plan: vi.fn(async () => ({
      total: 1_200,
      pageSize: 500,
      isCapped: false,
      keyColumns: ["ThreadId"],
    })),
    judgePage: vi.fn(async () => page()),
    finish: vi.fn(async () => ({ costUsd: 0.1, priceUsd: 0.13 })),
    ...runPort,
  };
  // The exact topology the pipeline mounts, composed on the runtime's own
  // definition builder, so the clamping, the intent-key prefixing and the
  // payload boundary are all the shipped ones.
  const definition = buildProcessManager<InstantEvalProcessingEvent>({
    name: INSTANT_EVAL_PROCESS_NAME,
    applier: instantEvalPM({
      runPort: port,
      commands: () => commands,
      clock: () => 999_999,
    }),
  });
  const manager = new ProcessManagerService({
    definition: buildProcessDefinition(definition.config),
    store,
  });
  const dispatcher = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(definition.config),
    processNames: [INSTANT_EVAL_PROCESS_NAME],
  });
  return { store, manager, dispatcher, definition, commands, port };
}

const requested = makeEvent({
  type: INSTANT_EVAL_EVENT_TYPES.REQUESTED,
  data: {
    runId: RUN_ID,
    name: null,
    sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
    parameters: {},
    questions: [{ id: "annoyed", kind: "boolean" }],
    rowLimit: 10_000,
  },
});

const planned = (overrides: Record<string, unknown> = {}) =>
  makeEvent({
    type: INSTANT_EVAL_EVENT_TYPES.PLANNED,
    occurredAt: 2_000,
    data: {
      runId: RUN_ID,
      total: 1_200,
      pageSize: 500,
      isCapped: false,
      keyColumns: ["ThreadId"],
      ...overrides,
    },
  });

const pageJudged = (overrides: Record<string, unknown>) =>
  makeEvent({
    type: INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED,
    occurredAt: 3_000,
    data: {
      runId: RUN_ID,
      page: 1,
      rows: 500,
      matched: 10,
      matchedByQuestion: { annoyed: 10 },
      failed: 0,
      skipped: 0,
      inputTokens: 900,
      requests: 500,
      cursor: "t500",
      hasNextPage: true,
      ...overrides,
    },
  });

describe("given a requested run", () => {
  describe("when the request is handled and its intent dispatched", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("plans the run and records the plan", async () => {
      const { manager, dispatcher, commands } = harness();

      const first = await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      expect(first.outcome).toBe("committed");

      const report = await dispatcher.runOnce({ now: 10_001 });

      expect(report.dispatched).toHaveLength(1);
      expect(commands.calls.recordPlanned).toEqual([
        {
          tenantId: PROJECT_ID,
          occurredAt: 999_999,
          runId: RUN_ID,
          total: 1_200,
          pageSize: 500,
          isCapped: false,
          keyColumns: ["ThreadId"],
        },
      ]);
    });
  });

  describe("when the plan lands", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("judges page one", async () => {
      const { manager, dispatcher, store, port } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });

      const pending = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.status === "pending",
      );
      expect(pending.map((message) => message.messageKey)).toContain(
        key(`page:${RUN_ID}:1`),
      );

      await dispatcher.runOnce({ now: 11_001 });
      expect(port.judgePage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, afterTraceId: null, pageSize: 500 }),
      );
    });
  });

  describe("when a page reports more to do", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("asks for the next page from the cursor it ended on", async () => {
      const { manager, store } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(pageJudged({ page: 1 })),
        now: 12_000,
      });

      const pending = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.status === "pending",
      );
      const next = pending.find(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(next?.payload).toMatchObject({
        page: 2,
        afterTraceId: "t500",
        remaining: 700,
      });
    });
  });

  describe("when the last page reports back", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("finishes the run with what it spent", async () => {
      const { manager, dispatcher, commands } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(
          pageJudged({ page: 1, rows: 1_200, hasNextPage: false }),
        ),
        now: 12_000,
      });
      await dispatcher.runOnce({ now: 12_001 });
      await dispatcher.runOnce({ now: 12_002 });

      expect(commands.calls.recordFinished).toEqual([
        expect.objectContaining({
          runId: RUN_ID,
          outcome: "finished",
          errorCode: null,
          inputTokens: 900,
          requests: 500,
          costUsd: 0.1,
          priceUsd: 0.13,
        }),
      ]);
    });
  });
});

describe("given a run in progress", () => {
  describe("when the same page is delivered again", () => {
    /** @scenario "A redelivered page writes the same judgements rather than doubling them" */
    it("leaves the run's progress where it was", async () => {
      const { manager, store } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      const event = pageJudged({ page: 1 });
      await manager.handleEvent({ envelope: toEnvelope(event), now: 12_000 });
      const again = await manager.handleEvent({
        envelope: toEnvelope(event),
        now: 12_500,
      });

      expect(again.outcome).toBe("duplicateEvent");
      const pages = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(pages).toHaveLength(1);
    });
  });

  describe("when a cancellation lands", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("does not judge another page and finishes as cancelled", async () => {
      const { manager, dispatcher, store, commands, port } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await dispatcher.runOnce({ now: 11_001 });
      const judgedPages = (port.judgePage as ReturnType<typeof vi.fn>).mock
        .calls.length;

      await manager.handleEvent({
        envelope: toEnvelope(
          makeEvent({
            type: INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED,
            occurredAt: 12_000,
            data: { runId: RUN_ID, requestedByUserId: null },
          }),
        ),
        now: 12_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(pageJudged({ page: 1 })),
        now: 12_500,
      });
      await dispatcher.runOnce({ now: 12_501 });

      const pages = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(pages).toHaveLength(0);
      expect(
        (port.judgePage as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(judgedPages);
      expect(commands.calls.recordFinished).toEqual([
        expect.objectContaining({ outcome: "cancelled" }),
      ]);
    });
  });

  describe("when its pages stop arriving", () => {
    /** @scenario "A run whose pages stop arriving is failed by the watchdog" */
    it("is failed by the wake with the stalled reason", async () => {
      const { manager, dispatcher, store, commands } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });

      const [wake] = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });
      expect(wake).toBeDefined();
      await manager.handleWake({
        wake: wake!,
        now: 11_000 + INSTANT_EVAL_STALL_THRESHOLD_MS + 1,
      });
      await dispatcher.runOnce({
        now: 11_000 + INSTANT_EVAL_STALL_THRESHOLD_MS + 2,
      });

      expect(commands.calls.recordFinished).toEqual([
        expect.objectContaining({
          outcome: "failed",
          errorCode: "instant_eval_stalled",
        }),
      ]);
    });
  });
});

describe("given a page whose judging fails", () => {
  describe("when attempts remain", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("hands the message back to the outbox", async () => {
      const { manager, dispatcher, store } = harness({
        judgePage: vi.fn(async () => {
          throw new Error("page lost most of its judgements");
        }),
      });

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await dispatcher.runOnce({ now: 11_001 });

      const pageMessage = (await store.findMessagesByRef({ ref: REF })).find(
        (message) => message.messageKey === key(`page:${RUN_ID}:1`),
      );
      expect(pageMessage?.status).not.toBe("dispatched");
    });
  });
});
