/**
 * The run's own row: the definition read back verbatim, scoped to its
 * project, listed newest first and paged by the instant-and-id pair.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { InstantEvalRunDefinition } from "../instant-eval-run.repository.ts";
import { MemoryInstantEvalRunRepository } from "../memory/memory.instant-eval-run.repository.ts";

const THIS_PROJECT = "project-1";
const OTHER_PROJECT = "project-2";

const clock = { at: Temporal.Instant.from("2026-09-18T10:00:00Z") };
let repository: MemoryInstantEvalRunRepository;

function definition(overrides: Partial<InstantEvalRunDefinition> = {}): InstantEvalRunDefinition {
  return {
    id: "instanteval_1",
    projectId: THIS_PROJECT,
    name: "annoyed customers",
    sql: "SELECT TraceId, eval(conversation(ConversationId), 'annoyed') AS annoyed FROM analytics.traces",
    parameters: { period: "7d" },
    questions: [{ id: "annoyed", kind: "boolean" }],
    plan: [{ column: "annoyed", function: "eval", options: ["annoyed"] }],
    rowLimit: 10_000,
    ...overrides,
  };
}

beforeEach(() => {
  clock.at = Temporal.Instant.from("2026-09-18T10:00:00Z");
  repository = MemoryInstantEvalRunRepository.create(() => clock.at);
});

describe("given a run the service accepted", () => {
  describe("when it is read back", () => {
    /** @scenario "A statement that projects a trace id and a judged column is accepted" */
    it("carries the definition verbatim and the counters at zero", async () => {
      const created = await repository.create(definition());

      const row = await repository.findById({ projectId: THIS_PROJECT, runId: created.id });

      expect(row).toMatchObject({
        id: created.id,
        projectId: THIS_PROJECT,
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
    });

    it("is not found through another project's key", async () => {
      const created = await repository.create(definition());

      expect(await repository.findById({ projectId: OTHER_PROJECT, runId: created.id })).toBeNull();
    });
  });

  describe("when the counters are laid over it", () => {
    it("keeps the definition the write carried forward", async () => {
      const created = await repository.create(definition());

      await repository.write({
        ...created,
        status: "RUNNING",
        total: 1_200,
        progress: 500,
        matched: 10,
        matchedByQuestion: { annoyed: 10 },
        tokens: 900,
        lastEventId: "evt-2",
      });
      const row = await repository.findById({ projectId: THIS_PROJECT, runId: created.id });

      expect(row).toMatchObject({
        sql: created.sql,
        questions: created.questions,
        plan: created.plan,
        status: "RUNNING",
        total: 1_200,
        progress: 500,
        matchedByQuestion: { annoyed: 10 },
        lastEventId: "evt-2",
      });
    });
  });

  describe("when its start was never dispatched", () => {
    it("is failed while queued and left alone once it moved on", async () => {
      const queued = await repository.create(definition());

      await repository.fail({ projectId: THIS_PROJECT, runId: queued.id, code: "internal_error" });
      const failed = await repository.findById({ projectId: THIS_PROJECT, runId: queued.id });

      expect(failed).toMatchObject({ status: "FAILED", error: "internal_error" });
      expect(failed?.finishedAt).not.toBeNull();

      await repository.fail({ projectId: THIS_PROJECT, runId: queued.id, code: "another_code" });
      const again = await repository.findById({ projectId: THIS_PROJECT, runId: queued.id });

      expect(again?.error).toBe("internal_error");
    });
  });
});

describe("given several runs in a project", () => {
  describe("when they are listed", () => {
    it("lists this project's runs newest first and pages by the pair", async () => {
      const first = await repository.create(definition({ id: "run-1", name: "first" }));
      clock.at = clock.at.add({ minutes: 1 });
      const second = await repository.create(definition({ id: "run-2", name: "second" }));
      clock.at = clock.at.add({ minutes: 1 });
      const third = await repository.create(definition({ id: "run-3", name: "third" }));
      await repository.create(definition({ id: "run-4", projectId: OTHER_PROJECT }));

      const page = await repository.findPage({ projectId: THIS_PROJECT, limit: 2 });

      expect(page.map((row) => row.id)).toEqual([third.id, second.id]);

      const last = page.at(-1);
      const next = await repository.findPage({
        projectId: THIS_PROJECT,
        limit: 2,
        ...(last ? { before: last.createdAt, beforeId: last.id } : {}),
      });

      expect(next.map((row) => row.id)).toEqual([first.id]);
    });

    it("orders two runs sharing an instant by their id, so a page never repeats one", async () => {
      await repository.create(definition({ id: "run-a" }));
      await repository.create(definition({ id: "run-b" }));

      const page = await repository.findPage({ projectId: THIS_PROJECT, limit: 1 });
      const last = page.at(-1);
      const next = await repository.findPage({
        projectId: THIS_PROJECT,
        limit: 1,
        ...(last ? { before: last.createdAt, beforeId: last.id } : {}),
      });

      expect(page.map((row) => row.id)).toEqual(["run-b"]);
      expect(next.map((row) => row.id)).toEqual(["run-a"]);
    });
  });
});
