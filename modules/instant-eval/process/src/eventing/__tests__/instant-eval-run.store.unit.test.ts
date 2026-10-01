/**
 * The projection's half of the run row: counters laid over what the service
 * wrote, never the definition, and never over a run that is gone.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { ProjectionStoreContext, StoredProjection } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalRunRow } from "../../__tests__/instant-eval.fixtures.ts";
import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import {
  INITIAL_INSTANT_EVAL_RUN_STATE,
  type InstantEvalRunProjectionState,
} from "../instant-eval-run.projection.ts";
import { InstantEvalRunProjectionStore } from "../instant-eval-run.store.ts";

const PROJECT_ID = "project-1";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-09-18T10:00:00Z");

const context: ProjectionStoreContext = {
  aggregateId: RUN_ID,
  tenantId: createTenantId(PROJECT_ID),
};

function projection(
  state: Partial<InstantEvalRunProjectionState> = {},
): StoredProjection<InstantEvalRunProjectionState> {
  return {
    state: { ...INITIAL_INSTANT_EVAL_RUN_STATE, ...state },
    cursor: { acceptedAt: AT.epochMilliseconds, eventId: "evt-1" },
    occurredAt: AT.epochMilliseconds,
    createdAt: AT.epochMilliseconds,
    updatedAt: AT.epochMilliseconds + 1_000,
    version: "2026-09-18",
  };
}

async function storeWithRun(overrides: Parameters<typeof instantEvalRunRow>[0] = {}): Promise<{
  store: InstantEvalRunProjectionStore;
  runs: MemoryInstantEvalRunRepository;
}> {
  const runs = MemoryInstantEvalRunRepository.create(() => AT);
  await runs.write(instantEvalRunRow({ id: RUN_ID, projectId: PROJECT_ID, ...overrides }));

  return { store: InstantEvalRunProjectionStore.create({ runs }), runs };
}

describe("given an accepted run nothing has been folded onto yet", () => {
  describe("when the fold looks for its checkpoint", () => {
    it("answers nothing, so the fold starts from the initial state", async () => {
      const { store } = await storeWithRun({ lastEventId: null, acceptedAt: null });

      expect(await store.get(RUN_ID, context)).toEqual({ kind: "empty" });
    });
  });
});

describe("given a run with a checkpoint", () => {
  describe("when the fold loads it", () => {
    it("reads back the counters the row carries", async () => {
      const { store } = await storeWithRun({
        lastEventId: "evt-9",
        acceptedAt: AT.epochMilliseconds,
      });

      const loaded = await store.get(RUN_ID, context);

      expect(loaded).toMatchObject({
        kind: "folded",
        projection: {
          state: { status: "RUNNING", progress: 40, matched: 12, tokens: 4_200 },
          cursor: { acceptedAt: AT.epochMilliseconds, eventId: "evt-9" },
        },
      });
    });
  });
});

describe("given a folded state to store", () => {
  describe("when the run's row is still there", () => {
    /** @scenario "The run row is folded from the page events" */
    it("lays the counters over the row without touching its definition", async () => {
      const { store, runs } = await storeWithRun();

      await store.store(
        projection({ status: "FINISHED", progress: 120, tokens: 9_000, finishedAtMs: 1_000 }),
        context,
      );
      const row = await runs.findById({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(row).toMatchObject({
        status: "FINISHED",
        progress: 120,
        tokens: 9_000,
        sql: "SELECT TraceId FROM analytics.traces",
        rowLimit: 1_000,
        lastEventId: "evt-1",
      });
      expect(row?.finishedAt?.epochMilliseconds).toBe(1_000);
    });

    it("stamps the row with the envelope's instants rather than the clock", async () => {
      const { store, runs } = await storeWithRun();

      await store.store(projection(), context);
      const row = await runs.findById({ projectId: PROJECT_ID, runId: RUN_ID });

      expect(row?.updatedAt.epochMilliseconds).toBe(AT.epochMilliseconds + 1_000);
      expect(row?.occurredAt).toBe(AT.epochMilliseconds);
    });
  });

  describe("when the run was deleted while it was judging", () => {
    it("writes nothing, so the run does not reappear", async () => {
      const runs = MemoryInstantEvalRunRepository.create(() => AT);
      const store = InstantEvalRunProjectionStore.create({ runs });

      await store.store(projection(), context);

      expect(await runs.findById({ projectId: PROJECT_ID, runId: RUN_ID })).toBeNull();
    });
  });
});
