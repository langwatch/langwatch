/**
 * Reading a run's judgements: page by page with a cursor, narrowed to one
 * question, and sampled beside the text that was judged.
 *
 * The run service is stood up on fakes, so these exercise the request path the
 * framework builds without a ClickHouse, a queue or a classifier.
 *
 * @see ../[[...route]]/app.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE,
  type InstantEvalRunServiceFakes,
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

beforeEach(() => {
  runs = harness.runs;
});

const { api, judgment } = harness;

describe("Feature: The Instant Eval run over REST", () => {
  describe("given a run with more judgements than one page carries", () => {
    describe("when the results are read twice with the returned cursor", () => {
      /** @scenario "Results are read page by page with a cursor that never repeats a row" */
      it("answers disjoint pages and no cursor on the last one", async () => {
        const first = [judgment(), judgment()];
        const second = [judgment()];
        runs.results
          .mockResolvedValueOnce({
            judgments: first,
            nextCursor: "cursor-after-page-one",
          })
          .mockResolvedValueOnce({ judgments: second });

        const pageOne = await api.get(
          `${BASE}/instant_eval_abc/results?limit=2`,
        );
        const pageOneBody = await pageOne.json();
        const pageTwo = await api.get(
          `${BASE}/instant_eval_abc/results?limit=2&cursor=${pageOneBody.nextCursor}`,
        );
        const pageTwoBody = await pageTwo.json();

        expect(pageOne.status).toBe(200);
        expect(pageOneBody.nextCursor).toBe("cursor-after-page-one");
        const ids = (body: { judgments: { traceId: string }[] }) =>
          body.judgments.map((one) => one.traceId);
        expect(
          ids(pageOneBody).filter((id) => ids(pageTwoBody).includes(id)),
        ).toEqual([]);
        expect(pageTwoBody.nextCursor).toBeUndefined();
        expect(runs.results).toHaveBeenLastCalledWith(
          expect.objectContaining({ cursor: "cursor-after-page-one" }),
        );
      });
    });
  });

  describe("given a run with two questions", () => {
    describe("when the results are read for one question and matches only", () => {
      /** @scenario "Results can be narrowed to one question and to the matches only" */
      it("answers only that question's passing judgements", async () => {
        runs.results.mockResolvedValue({
          judgments: [judgment({ questionId: "angry", passed: true })],
        });

        const res = await api.get(
          `${BASE}/instant_eval_abc/results?questionId=angry&matched=true`,
        );
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(runs.results).toHaveBeenCalledWith(
          expect.objectContaining({ questionId: "angry", isMatched: true }),
        );
        for (const one of body.judgments) {
          expect(one.questionId).toBe("angry");
          expect(one.passed).toBe(true);
        }
      });
    });
  });

  describe("given a finished run", () => {
    describe("when a sample of five rows is requested", () => {
      /** @scenario "A sample re-reads the text that was judged without judging it again" */
      it("answers the judged text beside the verdict", async () => {
        const one = judgment({ traceId: "trace-sampled" });
        runs.sample.mockResolvedValue({
          rows: [{ TraceId: "trace-sampled", angry: "I want a refund now" }],
          judgments: [one],
        });

        const res = await api.get(`${BASE}/instant_eval_abc/sample?n=5`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.rows).toEqual([
          { TraceId: "trace-sampled", angry: "I want a refund now" },
        ]);
        expect(body.judgments[0]).toMatchObject({
          traceId: "trace-sampled",
          passed: true,
        });
        expect(runs.sample).toHaveBeenCalledWith(
          expect.objectContaining({ n: 5 }),
        );
        // Reading a sample never starts a run, so nothing was judged again.
        expect(runs.create).not.toHaveBeenCalled();
      });
    });
  });
});
