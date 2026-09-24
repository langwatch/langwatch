/**
 * The pipeline the WORKER registers: what it mounts, what orders a run's
 * events against each other, and what makes a redelivered one land once.
 * @see dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md
 */

import { createTenantId, type Event } from "@langwatch/eventing";
import {
  INSTANT_EVAL_AGGREGATE_TYPE,
  INSTANT_EVAL_PIPELINE_NAME,
  INSTANT_EVAL_PROCESSING_EVENT_TYPES,
  instantEvalRequestedEventSchema,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import { INSTANT_EVAL_PROCESS_NAME } from "../instant-eval-processing-data.process.ts";
import {
  InstantEvalProcessingPipelineAdapter,
  type InstantEvalProcessingPipelineDefinition,
} from "../instant-eval-processing.pipeline.ts";
import { InstantEvalRunProjectionStore } from "../instant-eval-run.store.ts";
import { PROJECT_ID, RUN_ID } from "./instant-eval-process.fixtures.ts";

const AT = Temporal.Instant.from("2026-09-18T12:00:00Z");
const OCCURRED_AT = AT.epochMilliseconds;

function pipeline(): InstantEvalProcessingPipelineDefinition {
  return InstantEvalProcessingPipelineAdapter.create({
    instantEvalRunStore: InstantEvalRunProjectionStore.create({
      runs: MemoryInstantEvalRunRepository.create(() => AT),
    }),
    dispatch: {
      executor: { plan: vi.fn(), judgePage: vi.fn(), finish: vi.fn() },
      commands: () => ({
        recordPlanned: vi.fn(),
        recordPageJudged: vi.fn(),
        recordFinished: vi.fn(),
      }),
    },
  });
}

function commandNamed(name: string) {
  const registered = pipeline().commands.find((command) => command.definition.name === name);
  expect(registered, `the pipeline registered no ${name} command`).toBeDefined();

  return registered!;
}

/** The event one command mints from its payload, as the worker appends it. */
async function eventOf(name: string, data: Record<string, unknown>): Promise<Event> {
  const events = await commandNamed(name).open(async ({ handlerClass, createHandler }) => {
    const parsed = handlerClass.schema.validate({
      tenantId: PROJECT_ID,
      occurredAt: OCCURRED_AT,
      ...data,
    });
    if (!parsed.success) throw parsed.error;
    return createHandler().handle({
      tenantId: createTenantId(PROJECT_ID),
      aggregateId: RUN_ID,
      type: handlerClass.schema.type,
      data: parsed.data,
    });
  });
  const event = events[0];
  expect(event, `${name} minted no event`).toBeDefined();

  return event!;
}

/** One real event of the run, as the fold is given it. */
const requestedEvent = () =>
  instantEvalRequestedEventSchema.parse({
    id: `evt-requested-${OCCURRED_AT}`,
    aggregateId: RUN_ID,
    aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
    tenantId: PROJECT_ID,
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type: "lw.obs.instant_eval.requested",
    version: "2026-09-18",
    data: {
      runId: RUN_ID,
      name: null,
      sql: "SELECT TraceId FROM analytics.traces",
      parameters: {},
      questions: [{ id: "annoyed", kind: "boolean" }],
      rowLimit: 1_000,
    },
  });

const page = (overrides: Record<string, unknown> = {}) => ({
  runId: RUN_ID,
  page: 2,
  rows: 500,
  matched: 10,
  matchedByQuestion: { annoyed: 10 },
  failed: 0,
  skipped: 0,
  inputTokens: 1_200,
  requests: 500,
  cursor: "trace-500",
  cursorSpanId: null,
  hasNextPage: true,
  ...overrides,
});

const finished = {
  runId: RUN_ID,
  outcome: "finished",
  errorCode: null,
  inputTokens: 2_400,
  requests: 1_000,
  costUsd: 0.01,
  priceUsd: 0.013,
};

/** One complete payload per command, so each parses against its own schema. */
const payloadOf: Record<string, Record<string, unknown>> = {
  requestRun: requestedEvent().data,
  recordPlanned: { runId: RUN_ID, total: 1_000, pageSize: 500, isCapped: false, keyColumns: [] },
  recordPageJudged: page(),
  requestCancel: { runId: RUN_ID, requestedByUserId: null },
  recordFinished: finished,
};

describe("given the pipeline the worker registers", () => {
  describe("when it is built", () => {
    /** @scenario "The worker mounts one run projection, five commands and the process manager" */
    it("mounts one run projection, five commands and the process manager", () => {
      const built = pipeline();

      expect(built.metadata.name).toBe(INSTANT_EVAL_PIPELINE_NAME);
      expect(built.aggregate.type).toBe(INSTANT_EVAL_AGGREGATE_TYPE);
      expect(built.commands.map((command) => command.definition.name)).toEqual([
        "requestRun",
        "recordPlanned",
        "recordPageJudged",
        "requestCancel",
        "recordFinished",
      ]);
      expect([...(built.stateProjections?.keys() ?? [])]).toEqual(["instantEvalRun"]);
      expect([...built.processManagers.keys()]).toEqual([INSTANT_EVAL_PROCESS_NAME]);
    });

    it("mounts no map projection and no subscriber, because a page writes its own rows", () => {
      const built = pipeline();

      expect(built.mapProjections.size).toBe(0);
      expect(built.foldProjections.size).toBe(0);
      expect(built.eventSubscribers.size).toBe(0);
    });

    it("keys the run's counters by the run, so one row is one run", () => {
      const projection = pipeline().stateProjections?.get("instantEvalRun");

      expect(projection?.definition.key?.(requestedEvent())).toBe(RUN_ID);
      expect(projection?.definition.eventTypes).toEqual(INSTANT_EVAL_PROCESSING_EVENT_TYPES);
    });
  });
});

describe("given a run whose events arrive more than once", () => {
  describe("when the same page is recorded twice", () => {
    /** @scenario "A page recorded twice carries one event key, and the next page its own" */
    it("mints the same event key both times, so the second append collapses", async () => {
      const first = await eventOf("recordPageJudged", page());
      const again = await eventOf("recordPageJudged", page({ rows: 400 }));

      expect(again.idempotencyKey).toBe(first.idempotencyKey);
      expect(first.idempotencyKey).toContain("page-2");
    });

    it("mints a different key for the next page, so it is counted on its own", async () => {
      const second = await eventOf("recordPageJudged", page());
      const third = await eventOf("recordPageJudged", page({ page: 3 }));

      expect(third.idempotencyKey).not.toBe(second.idempotencyKey);
    });

    it("dedups the redelivery at the queue as well, inside the page's own window", async () => {
      const appended = await eventOf("recordPageJudged", page());
      const queued = commandNamed("recordPageJudged").open(({ handlerClass, options }) => {
        const deduplication = options?.deduplication;
        if (deduplication === undefined || deduplication === "aggregate") {
          throw new Error("the page command dedups by aggregate, which collapses different pages");
        }
        const parsed = handlerClass.schema.validate({
          tenantId: PROJECT_ID,
          occurredAt: OCCURRED_AT,
          ...page(),
        });
        if (!parsed.success) throw parsed.error;
        return { id: deduplication.makeId(parsed.data), ttlMs: deduplication.ttlMs };
      });

      expect(queued.id).toBe(appended.idempotencyKey);
      expect(queued.ttlMs).toBe(60_000);
    });
  });

  describe("when a phase that happens once is recorded twice", () => {
    /** @scenario "A finish delivered twice is one finish" */
    it("keys a finish by the run and its phase, so both deliveries are one finish", async () => {
      const first = await eventOf("recordFinished", finished);
      const again = await eventOf("recordFinished", { ...finished, priceUsd: 0.02 });

      expect(again.idempotencyKey).toBe(first.idempotencyKey);
      expect(first.idempotencyKey).toContain("finished");
    });
  });
});

describe("given two runs of one project judging at the same time", () => {
  describe("when their events are appended", () => {
    /** @scenario "Every event of a run is keyed by the run, so its pages fold in order" */
    it("puts every event of a run on the run's own aggregate, so its pages fold in order", () => {
      const aggregateIds = pipeline().commands.map((command) =>
        command.open(({ handlerClass }) => {
          const parsed = handlerClass.schema.validate({
            tenantId: PROJECT_ID,
            occurredAt: OCCURRED_AT,
            ...payloadOf[command.definition.name],
          });
          if (!parsed.success) throw parsed.error;
          return handlerClass.getAggregateId(parsed.data);
        }),
      );

      expect(aggregateIds).toEqual([RUN_ID, RUN_ID, RUN_ID, RUN_ID, RUN_ID]);
    });

    it("gives the project one queue lane, so a run's pages never overtake each other", () => {
      const groupKeys = pipeline().commands.map((command) =>
        command.open(({ handlerClass }) => {
          const parsed = handlerClass.schema.validate({
            tenantId: PROJECT_ID,
            occurredAt: OCCURRED_AT,
            ...payloadOf[command.definition.name],
          });
          if (!parsed.success) throw parsed.error;
          return handlerClass.getGroupKey?.(parsed.data);
        }),
      );

      expect(groupKeys).toEqual([PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID]);
    });
  });
});
