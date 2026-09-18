/**
 * Pricing a run before it starts, and reading one back: its counters, its
 * spend, the list scoped to the credential's project, and a run that belongs to
 * another one.
 *
 * The run service is stood up on fakes, so these exercise the request path the
 * framework builds without a ClickHouse, a queue or a classifier.
 *
 * @see ../[[...route]]/app.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstantEvalRunNotFoundError } from "~/server/app-layer/instant-evals/run/errors";
import {
  BASE,
  type InstantEvalRunServiceFakes,
  SQL,
  setupInstantEvalsApiHarness,
} from "./instantEvalsApiHarness";

const flagIsOn = vi.hoisted(() => ({ value: true }));

vi.mock("~/server/app-layer/instant-evals/access", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/app-layer/instant-evals/access")
    >();
  return {
    ...original,
    instantEvalsEnabled: async () => flagIsOn.value,
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
  describe("given a statement matching four hundred rows", () => {
    describe("when an estimate is requested", () => {
      /** @scenario "An estimate counts the rows and prices them without judging any" */
      it("reports the rows, the tokens, the requests, our cost and the price", async () => {
        runs.estimate.mockResolvedValue({
          rows: 400,
          isRowsCapped: false,
          avgTokens: 620,
          totalTokens: 248_000,
          requests: 400,
          costUsd: 0.010416,
          priceUsd: 0.013541,
        });

        const res = await api.post(`${BASE}/estimate`, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
          rows: 400,
          isRowsCapped: false,
          avgTokens: 620,
          totalTokens: 248_000,
          requests: 400,
          costUsd: 0.010416,
          priceUsd: 0.013541,
        });
        // Pricing a run never starts one, so nothing was queued and nothing
        // was judged.
        expect(runs.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a run that judged two pages", () => {
    describe("when it is read", () => {
      /** @scenario "A run reports its progress, its matches per question and what it spent" */
      it("carries the counters and the spend", async () => {
        runs.get.mockResolvedValue(
          runRow({
            status: "RUNNING",
            total: 400,
            progress: 200,
            matched: 37,
            matchedByQuestion: { angry: 37 },
            failed: 2,
            skipped: 1,
            tokens: 124_000,
            costUsd: 0.005208,
            priceUsd: 0.00677,
            startedAt: new Date("2026-09-18T10:00:05.000Z"),
          }),
        );

        const res = await api.get(`${BASE}/instant_eval_abc`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toMatchObject({
          status: "running",
          total: 400,
          progress: 200,
          matched: 37,
          matchedByQuestion: { angry: 37 },
          failed: 2,
          skipped: 1,
          tokens: 124_000,
          costUsd: 0.005208,
          priceUsd: 0.00677,
        });
        // The hydration plan is internal, so it is never published.
        expect(body).not.toHaveProperty("plan");
        expect(body).not.toHaveProperty("rowLimit");
      });
    });
  });

  describe("given two runs in this project and one in another", () => {
    describe("when the runs are listed", () => {
      /** @scenario "Runs are listed newest first and scoped to the credential's project" */
      it("lists only this project's runs, newest first", async () => {
        const newer = runRow({
          id: "instant_eval_newer",
          createdAt: new Date("2026-09-18T12:00:00.000Z"),
        });
        const older = runRow({
          id: "instant_eval_older",
          createdAt: new Date("2026-09-18T09:00:00.000Z"),
        });
        runs.list.mockResolvedValue([newer, older]);

        const res = await api.get(BASE);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.runs.map((run: { id: string }) => run.id)).toEqual([
          "instant_eval_newer",
          "instant_eval_older",
        ]);
        expect(runs.list).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: testProjectId }),
        );
      });
    });
  });

  describe("given a run belonging to another project", () => {
    describe("when it is read with this project's key", () => {
      /** @scenario "A run of another project is not found" */
      it("answers 404 instant_eval_not_found", async () => {
        runs.get.mockRejectedValue(
          new InstantEvalRunNotFoundError({ runId: "instant_eval_elsewhere" }),
        );

        const res = await api.get(`${BASE}/instant_eval_elsewhere`);
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.code).toBe("instant_eval_not_found");
      });
    });
  });
});
