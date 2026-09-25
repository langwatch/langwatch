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
vi.mock("../instant-eval-create", () => ({
  createInstantEvalRun: createRun,
  newInstantEvalRunId: () => "run_1",
}));
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
  isHoldRefused = false,
}: {
  standing: InstantEvalFreeBudgetStanding;
  exhausted?: boolean;
  /** Whether the run's estimated price fits beside the other holds. */
  isHoldRefused?: boolean;
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
  const reserve = vi.fn(async () => {
    if (isHoldRefused) {
      throw new InstantEvalFreeBudgetExhaustedError({
        spentUsd: standing.spentUsd,
        budgetUsd: standing.budgetUsd,
      });
    }
  });
  const release = vi.fn(async () => undefined);
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
    budget: {
      standing: async () => standing,
      assertWithinBudget,
      reserve,
      release,
    },
  });
  return { service, assertWithinBudget, reserve, release };
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
      estimateInstantEvalRun.mockResolvedValue({ rows: 10, priceUsd: 0.005 });
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

    /** @scenario "A run holds its estimated price when it is accepted" */
    it("holds the estimated price under the run's id before the run is queued", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      estimateInstantEvalRun.mockResolvedValue({ rows: 10, priceUsd: 0.005 });
      createRun.mockResolvedValue({ id: "run_1" });
      const { service, reserve, release } = await serviceWith({
        standing: {
          isFree: true,
          spentUsd: 0.5,
          budgetUsd: 1,
          remainingUsd: 0.5,
        },
      });

      await service.create({
        projectId: "proj_1",
        protections: PROTECTIONS,
        input: INPUT,
      });

      expect(reserve).toHaveBeenCalledWith({
        projectId: "proj_1",
        reservationId: "run_1",
        priceUsd: 0.005,
      });
      expect(createRun).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run_1" }),
      );
      expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
        createRun.mock.invocationCallOrder.at(-1) ?? 0,
      );
      expect(release).not.toHaveBeenCalled();
    });
  });

  describe("when the run's estimated price does not fit beside the other holds", () => {
    /** @scenario "Runs accepted together share the budget" */
    it("is refused and nothing is queued", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      estimateInstantEvalRun.mockResolvedValue({ rows: 10, priceUsd: 0.6 });
      createRun.mockReset();
      const { service } = await serviceWith({
        standing: {
          isFree: true,
          spentUsd: 0.2,
          budgetUsd: 1,
          remainingUsd: 0.8,
        },
        isHoldRefused: true,
      });

      const error = await service
        .create({ projectId: "proj_1", protections: PROTECTIONS, input: INPUT })
        .catch((thrown: unknown) => thrown);

      expect((error as { code?: unknown }).code).toBe(
        "instant_eval_free_budget_exhausted",
      );
      expect(createRun).not.toHaveBeenCalled();
    });
  });

  describe("when the run cannot be queued", () => {
    /** @scenario "A run that could not be queued holds nothing" */
    it("lets go of the hold it took", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      estimateInstantEvalRun.mockResolvedValue({ rows: 10, priceUsd: 0.005 });
      createRun.mockRejectedValue(new Error("queue is down"));
      const { service, release } = await serviceWith({
        standing: {
          isFree: true,
          spentUsd: 0.5,
          budgetUsd: 1,
          remainingUsd: 0.5,
        },
      });

      await expect(
        service.create({
          projectId: "proj_1",
          protections: PROTECTIONS,
          input: INPUT,
        }),
      ).rejects.toThrow("queue is down");

      expect(release).toHaveBeenCalledWith({
        projectId: "proj_1",
        reservationId: "run_1",
      });
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
  describe("when a run is requested", () => {
    /** @scenario "A paid organization has no budget" */
    it("is queued with no estimate and no hold", async () => {
      acceptInstantEvalStatement.mockResolvedValue({ questions: [] });
      estimateInstantEvalRun.mockReset();
      createRun.mockResolvedValue({ id: "run_1" });
      const { service, reserve } = await serviceWith({ standing: PAID });

      const row = await service.create({
        projectId: "proj_1",
        protections: PROTECTIONS,
        input: INPUT,
      });

      expect(row).toEqual({ id: "run_1" });
      expect(estimateInstantEvalRun).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
    });
  });

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
