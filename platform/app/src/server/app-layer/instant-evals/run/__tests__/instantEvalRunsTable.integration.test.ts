/**
 * The run's ClickHouse row: written by the service and by the projection,
 * read back as one row, listed newest first and paged by the pair.
 *
 * These run against the real table migration 00098 creates, because what they
 * assert is a property of the schema and the write protocol rather than of
 * the repository alone: that two writers on one replacing row collapse to the
 * latest write, that the sort key puts `TenantId` first so a read by run id
 * cannot cross a project, and that the projection's write carries the
 * definition forward unchanged.
 *
 * @see ../instant-eval-run.repository.ts
 * @see ../instant-eval-run.projection-store.ts
 * @see ../../../../clickhouse/migrations/00098_create_instant_eval_runs.sql
 * @see ../../../../../../../specs/instant-evals/instant-eval-api.feature
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import { ClickHouseInstantEvalRunProjectionStore } from "../instant-eval-run.projection-store";
import {
  ClickHouseInstantEvalRunRepository,
  type InstantEvalRunDefinition,
} from "../instant-eval-run.repository";

const thisProject = `test-instant-eval-runs-${nanoid()}`;
const otherProject = `test-instant-eval-runs-other-${nanoid()}`;

let ch: ClickHouseClient;
let clock: number;
let repository: ClickHouseInstantEvalRunRepository;
let store: ClickHouseInstantEvalRunProjectionStore;

function definition(
  overrides: Partial<InstantEvalRunDefinition> = {},
): InstantEvalRunDefinition {
  return {
    id: `instanteval_${nanoid()}`,
    projectId: thisProject,
    name: "annoyed customers",
    sql: "SELECT TraceId, eval(conversation(ConversationId), 'annoyed') AS annoyed FROM analytics.traces",
    parameters: { period: "7d" },
    questions: [{ id: "annoyed", kind: "boolean" }],
    plan: [{ column: "annoyed", function: "eval", options: ["annoyed"] }],
    rowLimit: 10_000,
    ...overrides,
  };
}

function contextFor(runId: string, projectId = thisProject) {
  return {
    aggregateId: runId,
    tenantId: createTenantId(projectId),
  } satisfies ProjectionStoreContext;
}

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("ClickHouse is not available for this test");
  ch = client;
  clock = Date.now();
  repository = new ClickHouseInstantEvalRunRepository({
    resolveClient: async () => ch,
    // Advances on every read so consecutive writes never share a version.
    now: () => (clock += 1),
  });
  store = new ClickHouseInstantEvalRunProjectionStore(repository);
});

describe("given a run the service accepted", () => {
  describe("when it is read back", () => {
    /** @scenario "A statement that projects a trace id and a judged column is accepted" */
    it("carries the definition verbatim and the counters at zero", async () => {
      const created = await repository.create(definition());

      const row = await repository.findById({
        projectId: thisProject,
        runId: created.id,
      });

      expect(row).toMatchObject({
        id: created.id,
        projectId: thisProject,
        name: "annoyed customers",
        sql: created.sql,
        parameters: { period: "7d" },
        questions: [{ id: "annoyed", kind: "boolean" }],
        plan: [{ column: "annoyed", function: "eval", options: ["annoyed"] }],
        rowLimit: 10_000,
        status: "QUEUED",
        total: null,
        progress: 0,
        matched: null,
        matchedByQuestion: {},
        tokens: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        lastEventId: null,
      });
      expect(row?.createdAt.getTime()).toBe(created.createdAt.getTime());
    });

    /** @scenario "A run of another project is not found" */
    it("is not found through another project's key", async () => {
      const created = await repository.create(definition());

      const row = await repository.findById({
        projectId: otherProject,
        runId: created.id,
      });

      expect(row).toBeNull();
    });
  });

  describe("when the projection folds its first events", () => {
    /** @scenario "The run row is folded from the page events" */
    it("lays the counters over the definition without rewriting it", async () => {
      const created = await repository.create(definition());
      const context = contextFor(created.id);

      // No checkpoint yet, so the fold starts from init() rather than from
      // counters that were never applied.
      expect(await store.load(created.id, context)).toBeNull();

      await store.store(
        {
          state: {
            status: "RUNNING",
            total: 1_200,
            progress: 500,
            matched: 10,
            matchedByQuestion: { annoyed: 10 },
            failed: 1,
            skipped: 2,
            tokens: 900,
            costUsd: 0,
            priceUsd: 0,
            error: null,
            startedAtMs: created.createdAt.getTime() + 1_000,
            finishedAtMs: null,
          },
          cursor: {
            acceptedAt: created.createdAt.getTime() + 2_000,
            eventId: "evt-2",
          },
          occurredAt: created.createdAt.getTime() + 2_000,
          createdAt: created.createdAt.getTime(),
          updatedAt: created.createdAt.getTime() + 2_000,
          version: "2026-09-18",
        },
        context,
      );

      const row = await repository.findById({
        projectId: thisProject,
        runId: created.id,
      });
      expect(row).toMatchObject({
        sql: created.sql,
        questions: created.questions,
        plan: created.plan,
        rowLimit: 10_000,
        status: "RUNNING",
        total: 1_200,
        progress: 500,
        matched: 10,
        matchedByQuestion: { annoyed: 10 },
        failed: 1,
        skipped: 2,
        tokens: 900,
        lastEventId: "evt-2",
        projectionVersion: "2026-09-18",
      });
      expect(row?.startedAt?.getTime()).toBe(
        created.createdAt.getTime() + 1_000,
      );
      expect(row?.updatedAt.getTime()).toBe(
        created.createdAt.getTime() + 2_000,
      );

      const loaded = await store.load(created.id, context);
      expect(loaded?.cursor).toEqual({
        acceptedAt: created.createdAt.getTime() + 2_000,
        eventId: "evt-2",
      });
      expect(loaded?.state.progress).toBe(500);
    });

    it("writes nothing for a run whose row is gone", async () => {
      const runId = `instanteval_${nanoid()}`;
      await store.store(
        {
          state: {
            status: "RUNNING",
            total: 1,
            progress: 1,
            matched: null,
            matchedByQuestion: {},
            failed: 0,
            skipped: 0,
            tokens: 1,
            costUsd: 0,
            priceUsd: 0,
            error: null,
            startedAtMs: null,
            finishedAtMs: null,
          },
          cursor: { acceptedAt: 1, eventId: "evt-1" },
          occurredAt: 1,
          createdAt: 1,
          updatedAt: 1,
          version: "2026-09-18",
        },
        contextFor(runId),
      );

      expect(
        await repository.findById({ projectId: thisProject, runId }),
      ).toBeNull();
    });
  });

  describe("when its start was never dispatched", () => {
    it("is failed while queued and left alone once it started", async () => {
      const queued = await repository.create(definition());
      await repository.fail({
        projectId: thisProject,
        runId: queued.id,
        code: "internal_error",
      });
      const failed = await repository.findById({
        projectId: thisProject,
        runId: queued.id,
      });
      expect(failed).toMatchObject({
        status: "FAILED",
        error: "internal_error",
      });
      expect(failed?.finishedAt).not.toBeNull();

      // A second fail cannot overtake a run that moved on.
      await repository.fail({
        projectId: thisProject,
        runId: queued.id,
        code: "another_code",
      });
      const again = await repository.findById({
        projectId: thisProject,
        runId: queued.id,
      });
      expect(again?.error).toBe("internal_error");
    });
  });
});

describe("given several runs in a project", () => {
  describe("when they are listed", () => {
    /** @scenario "Runs are listed newest first and scoped to the credential's project" */
    it("lists this project's runs newest first and pages by the pair", async () => {
      const listProject = `test-instant-eval-runs-list-${nanoid()}`;
      const first = await repository.create(
        definition({ projectId: listProject, name: "first" }),
      );
      const second = await repository.create(
        definition({ projectId: listProject, name: "second" }),
      );
      const third = await repository.create(
        definition({ projectId: listProject, name: "third" }),
      );
      await repository.create(definition({ projectId: otherProject }));

      const page = await repository.list({ projectId: listProject, limit: 2 });
      expect(page.map((row) => row.id)).toEqual([third.id, second.id]);

      const last = page.at(-1);
      const next = await repository.list({
        projectId: listProject,
        limit: 2,
        ...(last ? { before: last.createdAt, beforeId: last.id } : {}),
      });
      expect(next.map((row) => row.id)).toEqual([first.id]);
    });
  });
});
