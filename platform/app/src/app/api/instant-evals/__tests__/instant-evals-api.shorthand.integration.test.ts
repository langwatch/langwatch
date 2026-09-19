/**
 * The shorthand over REST: the flat body a caller writes, and the shorthand the
 * service is handed.
 *
 * The run service is stood up on fakes, so what these hold is the boundary's
 * own decision: which of `sql` and `target` the request meant, and what the
 * service receives for each. What the expansion WRITES is held by
 * `server/app-layer/instant-evals/shorthand/__tests__`, against the real query
 * validator.
 *
 * @see ../[[...route]]/schemas.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-shorthand.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstantEvalQueryInvalidError } from "~/server/app-layer/instant-evals/run/errors";
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
const { api, runRow } = harness;

let runs: InstantEvalRunServiceFakes;

beforeEach(() => {
  runs = harness.runs;
});

const QUESTION = {
  id: "annoyed",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

describe("Feature: The Instant Eval shorthand", () => {
  describe("given a request naming a target and one question", () => {
    describe("when it is submitted to the run endpoint", () => {
      /** @scenario "A request carrying a target and no statement is expanded" */
      it("hands the service the shorthand and answers 202", async () => {
        runs.create.mockResolvedValue(runRow());

        const res = await api.post(BASE, {
          target: "threads",
          filter: "service:checkout",
          start: "2026-09-01T00:00:00.000Z",
          end: "2026-09-08T00:00:00.000Z",
          questions: [QUESTION],
          limit: 500,
        });

        expect(res.status).toBe(202);
        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              limit: 500,
              shorthand: {
                target: "threads",
                filter: "service:checkout",
                start: "2026-09-01T00:00:00.000Z",
                end: "2026-09-08T00:00:00.000Z",
                questions: [{ ...QUESTION, kind: "boolean" }],
              },
            },
          }),
        );
      });

      /** @scenario "A question with no id of its own is named by its position" */
      it("reads a question with no kind of its own as a yes or no question", async () => {
        runs.create.mockResolvedValue(runRow());

        await api.post(BASE, {
          target: "traces",
          questions: [{ instructions: "The customer sounds annoyed" }],
        });

        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              shorthand: expect.objectContaining({
                questions: [
                  {
                    kind: "boolean",
                    instructions: "The customer sounds annoyed",
                  },
                ],
              }),
            }),
          }),
        );
      });
    });
  });

  describe("given a request carrying both a statement and a target", () => {
    describe("when it is submitted", () => {
      /** @scenario "A request carrying both a statement and a target is refused" */
      it("answers 422 saying to send one of the two", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryInvalidError({
            reason:
              "A run takes a statement or a target, not both. Send sql to run a statement you wrote, or target with your questions to have one written for you.",
            fields: ["sql", "target"],
          }),
        );

        const res = await api.post(BASE, {
          sql: SQL,
          target: "traces",
          questions: [QUESTION],
        });
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("instant_eval_query_invalid");
        expect(body.meta.fields).toEqual(["sql", "target"]);
      });
    });
  });

  describe("given a request carrying neither", () => {
    describe("when it is submitted", () => {
      /** @scenario "A request carrying neither a statement nor a target is refused" */
      it("answers 422 naming both ways to ask", async () => {
        runs.create.mockRejectedValue(
          new InstantEvalQueryInvalidError({
            reason:
              "A run needs something to judge: send sql with a statement, or target with the questions to ask of each row.",
            fields: ["sql", "target"],
          }),
        );

        const res = await api.post(BASE, { name: "nothing to judge" });

        expect(res.status).toBe(422);
        expect(runs.create).toHaveBeenCalledWith(
          expect.objectContaining({ input: { name: "nothing to judge" } }),
        );
      });
    });
  });

  describe("given a shorthand sent to the estimate endpoint", () => {
    describe("when it is priced", () => {
      /** @scenario "The estimate answers for a shorthand too" */
      it("hands the same shorthand to the estimate", async () => {
        runs.estimate.mockResolvedValue({
          rows: 120,
          isRowsCapped: false,
          avgTokens: 900,
          totalTokens: 108_000,
          requests: 120,
          costUsd: 0.0045,
          priceUsd: 0.0059,
        });

        const res = await api.post(`${BASE}/estimate`, {
          target: "traces",
          questions: [QUESTION],
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.rows).toBe(120);
        expect(runs.estimate).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              shorthand: {
                target: "traces",
                questions: [{ ...QUESTION, kind: "boolean" }],
              },
            },
          }),
        );
      });
    });
  });
});
