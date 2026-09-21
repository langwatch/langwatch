/**
 * Shared setup for the Instant Eval process-flow suites: an in-memory process
 * store, the topology the pipeline mounts, a fake domain port, and the events a
 * run is driven with.
 *
 * Not a suite itself, so vitest does not collect it.
 *
 * @see ../../pipeline.ts
 */

import { vi } from "vitest";

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
import { INSTANT_EVAL_PROCESS_NAME } from "../instantEvalProcess.types";

export const PROJECT_ID = "project-1";
export const RUN_ID = "instanteval_1";
export const REF = {
  processName: INSTANT_EVAL_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: RUN_ID,
};

export function makeEvent(overrides: {
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

export function toEnvelope(event: InstantEvalProcessingEvent) {
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
export function key(suffix: string): string {
  return `process:${encodeURIComponent(RUN_ID)}:${suffix}`;
}

export const page = (overrides: Partial<InstantEvalPageOutcome> = {}) =>
  ({
    rows: 500,
    matched: 10,
    matchedByQuestion: { annoyed: 10 },
    failed: 0,
    skipped: 0,
    inputTokens: 900,
    requests: 500,
    cursor: "t500",
    cursorSpanId: null,
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

export function harness(runPort: Partial<InstantEvalRunPort> = {}) {
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

export const requested = makeEvent({
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

export const planned = (overrides: Record<string, unknown> = {}) =>
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

export const pageJudged = (overrides: Record<string, unknown>) =>
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
      cursorSpanId: null,
      hasNextPage: true,
      ...overrides,
    },
  });
