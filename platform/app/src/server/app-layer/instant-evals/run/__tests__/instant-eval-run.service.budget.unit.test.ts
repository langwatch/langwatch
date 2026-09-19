/**
 * The free budget at the run service: a create is refused before the
 * statement is accepted, and an estimate carries what is left.
 *
 * The statement acceptance and the estimate arithmetic are faked: what is
 * under test is where the budget sits in the order of checks.
 *
 * @see ../instant-eval-run.service.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it, vi } from "vitest";
import type { InstantEvalFreeBudgetStanding } from "../../../usage/instant-eval-free-budget.service";
import { InstantEvalFreeBudgetExhaustedError } from "../../errors";

const { acceptInstantEvalStatement, estimateInstantEvalRun, createRun } =
  vi.hoisted(() => ({
    acceptInstantEvalStatement: vi.fn(),
    estimateInstantEvalRun: vi.fn(),
    createRun: vi.fn(),
  }));

vi.mock("../statement", () => ({ acceptInstantEvalStatement }));
vi.mock("../instant-eval-estimate", () => ({ estimateInstantEvalRun }));
vi.mock("../instant-eval-create", () => ({ createInstantEvalRun: createRun }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const PROTECTIONS = {} as never;
const INPUT = { sql: "SELECT TraceId, eval('angry') AS angry FROM traces" };

const PAID: InstantEvalFreeBudgetStanding = {
  isFree: false,
  spentUsd: 0,
  budgetUsd: 1,
  remainingUsd: null,
};

async function serviceWith({
  standing,
  exhausted = false,
}: {
  standing: InstantEvalFreeBudgetStanding;
  exhausted?: boolean;
}) {
  const { InstantEvalRunService } = await import("../instant-eval-run.service");
  const assertWithinBudget = vi.fn(async () => {
    if (exhausted) {
      throw new InstantEvalFreeBudgetExhaustedError({
        spentUsd: standing.spentUsd,
        budgetUsd: standing.budgetUsd,
      });
    }
  });
  const service = new InstantEvalRunService({
    runs: {} as never,
    judgments: {} as never,
    rowSource: {} as never,
    query: {} as never,
    classifier: () => ({}) as never,
    commands: () => ({}) as never,
    cancellations: {} as never,
    isEnabled: async () => true,
    caller: async () => ({ id: "proj_1", lwqlKey: "key" }) as never,
    plan: async () => ({ name: "free", isFree: standing.isFree }),
    budget: { standing: async () => standing, assertWithinBudget },
  });
  return { service, assertWithinBudget };
}

describe("given an organization that has spent its free budget", () => {
  describe("when a run is requested", () => {
    /** @scenario "At the budget a run is refused" */
    it("is refused before the statement is accepted", async () => {
      const { service } = await serviceWith({
        standing: { isFree: true, spentUsd: 1, budgetUsd: 1, remainingUsd: 0 },
        exhausted: true,
      });

      const error = await service
        .create({ projectId: "proj_1", protections: PROTECTIONS, input: INPUT })
        .catch((thrown: unknown) => thrown);

      expect((error as { code?: unknown }).code).toBe(
        "instant_eval_free_budget_exhausted",
      );
      expect(acceptInstantEvalStatement).not.toHaveBeenCalled();
      expect(createRun).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization under its free budget", () => {
  describe("when a run is requested", () => {
    /** @scenario "Under the budget a run is accepted" */
    it("is accepted", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      createRun.mockResolvedValue({ id: "run_1" });
      const { service, assertWithinBudget } = await serviceWith({
        standing: {
          isFree: true,
          spentUsd: 0.99,
          budgetUsd: 1,
          remainingUsd: 0.01,
        },
      });

      const row = await service.create({
        projectId: "proj_1",
        protections: PROTECTIONS,
        input: INPUT,
      });

      expect(row).toEqual({ id: "run_1" });
      expect(assertWithinBudget).toHaveBeenCalledWith({ projectId: "proj_1" });
    });
  });

  describe("when a run is estimated", () => {
    /** @scenario "The estimate tells a free organization what is left" */
    it("carries the price and what is left of the budget", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      estimateInstantEvalRun.mockResolvedValue({
        rows: 10,
        priceUsd: 0.5,
      });
      const { service } = await serviceWith({
        standing: {
          isFree: true,
          spentUsd: 0.4,
          budgetUsd: 1,
          remainingUsd: 0.6,
        },
      });

      const estimate = await service.estimate({
        projectId: "proj_1",
        protections: PROTECTIONS,
        input: INPUT,
      });

      expect(estimate).toEqual({
        rows: 10,
        priceUsd: 0.5,
        freeBudgetRemainingUsd: 0.6,
      });
    });
  });
});

describe("given an organization on a paid plan", () => {
  describe("when a run is estimated", () => {
    /** @scenario "The estimate tells a paid organization nothing about a free budget" */
    it("carries the price and no free budget figure", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      estimateInstantEvalRun.mockResolvedValue({ rows: 10, priceUsd: 0.5 });
      const { service } = await serviceWith({ standing: PAID });

      const estimate = await service.estimate({
        projectId: "proj_1",
        protections: PROTECTIONS,
        input: INPUT,
      });

      expect(estimate).toEqual({ rows: 10, priceUsd: 0.5 });
      expect("freeBudgetRemainingUsd" in estimate).toBe(false);
    });
  });
});
