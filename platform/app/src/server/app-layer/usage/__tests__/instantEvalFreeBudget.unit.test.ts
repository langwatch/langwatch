/**
 * The free Instant Evals budget: one dollar across every project of an
 * organization without a paid plan, read once a minute.
 *
 * @see ../instant-eval-free-budget.service.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  INSTANT_EVAL_FREE_BUDGET_USD,
  InstantEvalFreeBudgetService,
} from "../instant-eval-free-budget.service";

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
}));

const NANO = 1_000_000_000;

function serviceWith({
  spentNanoUsd = 0,
  isFree = true,
  projects = ["proj_1"],
}: {
  spentNanoUsd?: number;
  isFree?: boolean;
  projects?: string[];
} = {}) {
  const sumSpendNanoUsd = vi.fn(async () => spentNanoUsd);
  const service = new InstantEvalFreeBudgetService({
    organizationOf: async () => "org_1",
    projectsOf: async () => projects,
    isFreePlan: async () => isFree,
    sumSpendNanoUsd,
  });
  return { service, sumSpendNanoUsd };
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "no error was thrown";
}

describe("given an organization with no paid plan", () => {
  describe("when it has spent 0.99 dollars", () => {
    /** @scenario "Under the budget a run is accepted" */
    it("is within the budget", async () => {
      const { service } = serviceWith({ spentNanoUsd: 0.99 * NANO });

      await expect(
        service.assertWithinBudget({ projectId: "proj_1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when it has spent 1.00 dollars", () => {
    /** @scenario "At the budget a run is refused" */
    it("is refused, naming what was spent and the budget", async () => {
      const { service } = serviceWith({ spentNanoUsd: 1 * NANO });

      const error = await service
        .assertWithinBudget({ projectId: "proj_1" })
        .catch((thrown: unknown) => thrown);

      expect((error as { code?: unknown }).code).toBe(
        "instant_eval_free_budget_exhausted",
      );
      expect((error as { httpStatus?: unknown }).httpStatus).toBe(402);
      expect((error as { meta?: unknown }).meta).toEqual({
        spentUsd: 1,
        budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
      });
    });
  });

  describe("when its projects spent 0.60 and 0.50 dollars", () => {
    /** @scenario "The spend is read across every project of the organization" */
    it("reads the spend across both projects and refuses", async () => {
      const { service, sumSpendNanoUsd } = serviceWith({
        spentNanoUsd: 1.1 * NANO,
        projects: ["proj_1", "proj_2"],
      });

      expect(
        await codeOf(() => service.assertWithinBudget({ projectId: "proj_2" })),
      ).toBe("instant_eval_free_budget_exhausted");
      expect(sumSpendNanoUsd).toHaveBeenCalledWith({
        tenantIds: ["proj_1", "proj_2"],
        requestType: "instant_eval",
      });
    });
  });

  describe("when the budget is checked twice within a minute", () => {
    /** @scenario "The spend is cached per organization for one minute" */
    it("reads the ledger once", async () => {
      const { service, sumSpendNanoUsd } = serviceWith({ spentNanoUsd: 0 });

      await service.assertWithinBudget({ projectId: "proj_1" });
      await service.standing({ projectId: "proj_1" });

      expect(sumSpendNanoUsd).toHaveBeenCalledTimes(1);
    });
  });

  describe("when it has spent 0.40 dollars and asks where it stands", () => {
    /** @scenario "The estimate tells a free organization what is left" */
    it("answers sixty cents remaining", async () => {
      const { service } = serviceWith({ spentNanoUsd: 0.4 * NANO });

      expect(await service.standing({ projectId: "proj_1" })).toEqual({
        isFree: true,
        spentUsd: 0.4,
        budgetUsd: 1,
        remainingUsd: 0.6,
      });
    });
  });
});

describe("given an organization on a paid plan", () => {
  describe("when it has spent ten dollars", () => {
    /** @scenario "A paid organization has no budget" */
    /** @scenario "The estimate tells a paid organization nothing about a free budget" */
    it("has no budget to be within, and reads no spend", async () => {
      const { service, sumSpendNanoUsd } = serviceWith({
        spentNanoUsd: 10 * NANO,
        isFree: false,
      });

      await expect(
        service.assertWithinBudget({ projectId: "proj_1" }),
      ).resolves.toBeUndefined();
      expect(
        (await service.standing({ projectId: "proj_1" })).remainingUsd,
      ).toBeNull();
      expect(sumSpendNanoUsd).not.toHaveBeenCalled();
    });
  });
});
