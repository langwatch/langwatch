/**
 * Creating a run over REST: what the wire answers for a statement it accepts,
 * for one the query policy refuses, and for a row count past the plan's cap.
 *
 * The run service is stood up on fakes, so these exercise the request path the
 * framework builds without a ClickHouse, a queue or a classifier.
 *
 * @see ../[[...route]]/app.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstantEvalFreeBudgetExhaustedError } from "~/server/app-layer/instant-evals/errors";
import {
  InstantEvalQueryInvalidError,
  InstantEvalQueryMissingColumnsError,
  InstantEvalRowCapExceededError,
} from "~/server/app-layer/instant-evals/run/errors";
import {
  BASE,
  type InstantEvalRunServiceFakes,
  SQL,
  setupInstantEvalsApiHarness,
} from "./instantEvalsApiHarness";

const flagIsOn = vi.hoisted(() => ({ isEnabled: true }));

vi.mock("~/server/app-layer/instant-evals/access", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/app-layer/instant-evals/access")
    >();
  return {
    ...original,
    instantEvalsEnabled: async () => flagIsOn.isEnabled,
  };
});

const harness = setupInstantEvalsApiHarness({ flag: flagIsOn });

let runs: InstantEvalRunServiceFakes;
let testProjectId: string;

beforeEach(() => {
  runs = harness.runs;
  testProjectId = harness.projectId;
});

const { api, runRow } = harness;

describe("Feature: The Instant Eval run over REST", () => {
  describe("given a free organization past its Instant Evals budget", () => {
    describe("when a run is requested", () => {
      /** @scenario "The refusal reaches a REST caller as a 402 with its meta" */
      it("answers 402 with the code and what was spent against the budget", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalFreeBudgetExhaustedError({
            spentUsd: 1.02,
            budgetUsd: 1,
          }),
        );

        const res = await api.post(BASE, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(402);
        expect(body.code).toBe("instant_eval_free_budget_exhausted");
        expect(body.meta).toEqual({ spentUsd: 1.02, budgetUsd: 1 });
      });
    });
  });

  describe("given a statement that projects a trace id and a judged column", () => {
    describe("when it is submitted to the run endpoint", () => {
      /** @scenario "A statement that projects a trace id and a judged column is accepted" */
      it("answers 202 with the queued run, its questions and its statement", async () => {
        runs.create.mockResolvedValue(runRow());

        const res = await api.post(BASE, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body.status).toBe("queued");
        expect(body.sql).toBe(SQL);
        expect(body.questions).toEqual([
          {
            id: "angry",
            function: "eval",
            kind: "boolean",
            reads: "probability",
            threshold: 0.5,
          },
        ]);
        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: testProjectId }),
        );
      });

      /** @scenario "A statement the query policy refuses is refused here with the same reason" */
      it("answers 422 naming the policy violations", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryInvalidError({
            reason: "That statement reads a dataset this key may not query.",
            violations: [{ code: "table_not_allowed", table: "secrets" }],
          }),
        );

        const res = await api.post(BASE, { sql: "SELECT * FROM secrets" });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_invalid");
        expect(body.meta.violations).toEqual([
          { code: "table_not_allowed", table: "secrets" },
        ]);
      });

      /** @scenario "A statement with no trace id is refused before anything runs" */
      it("answers 422 naming TraceId as the missing column", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryMissingColumnsError({
            missing: ["TraceId"],
            isEvalFunctionMissing: false,
          }),
        );

        const res = await api.post(BASE, {
          sql: "SELECT eval('angry') AS angry FROM traces",
        });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_missing_columns");
        expect(body.meta.missing).toEqual(["TraceId"]);
      });

      /** @scenario "A statement with no eval function is refused" */
      it("answers 422 saying an eval function is required", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryMissingColumnsError({
            missing: ["an eval function"],
            isEvalFunctionMissing: true,
          }),
        );

        const res = await api.post(BASE, {
          sql: "SELECT TraceId FROM traces",
        });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_missing_columns");
        expect(body.meta.isEvalFunctionMissing).toBe(true);
      });
    });
  });

  // ── caps ───────────────────────────────────────────────────────────────────

  describe("given a project on a plan without the raised cap", () => {
    describe("when a run is requested for fifty thousand rows", () => {
      /** @scenario "A free plan asking past the default cap is refused and told what lifts it" */
      it("answers 422 carrying the cap and the plan", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalRowCapExceededError({
            requested: 50_000,
            cap: 10_000,
            plan: "free",
            maxCap: 100_000,
          }),
        );

        const res = await api.post(BASE, { sql: SQL, limit: 50_000 });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_row_cap_exceeded");
        expect(body.meta).toMatchObject({
          requested: 50_000,
          cap: 10_000,
          plan: "free",
          maxCap: 100_000,
        });
      });
    });
  });

  describe("given a project on a plan with the raised cap", () => {
    describe("when a run is requested for fifty thousand rows", () => {
      /** @scenario "A paid plan may ask up to the raised cap" */
      it("accepts the run with that limit", async () => {
        runs.create.mockResolvedValue(runRow({ rowLimit: 50_000 }));

        const res = await api.post(BASE, { sql: SQL, limit: 50_000 });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body.limit).toBe(50_000);
        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({ limit: 50_000 }),
          }),
        );
      });
    });
  });
});
