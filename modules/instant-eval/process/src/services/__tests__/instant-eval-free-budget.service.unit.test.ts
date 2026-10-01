/**
 * The free Instant Evals budget: one dollar across every project of an
 * organization without a paid plan, read once a minute.
 *
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryInstantEvalBudgetReservationsChannel } from "../../channels/memory/memory.instant-eval-budget-reservations.channel.ts";
import { INSTANT_EVAL_FREE_BUDGET_USD } from "../../rules/instant-eval-budget.rules.ts";
import { InstantEvalFreeBudgetService } from "../instant-eval-free-budget.service.ts";

const NANO = 1_000_000_000;

function serviceWith({
  spentNanoUsd = 0,
  isFree = true,
  projects = ["proj_1"],
  isBounded = true,
}: {
  spentNanoUsd?: number;
  isFree?: boolean;
  projects?: string[];
  isBounded?: boolean;
} = {}) {
  const clock = { now: 0 };
  const sumSpendNanoUsdByRequestType = vi.fn(async () => spentNanoUsd);
  const reservations = MemoryInstantEvalBudgetReservationsChannel.create({
    now: () => Temporal.Instant.fromEpochMilliseconds(clock.now),
  });
  const service = InstantEvalFreeBudgetService.create({
    peers: {
      findOrganizationId: async () => "org_1",
      listProjectIds: async () => projects,
      isFreePlan: async () => isFree,
      sumSpendNanoUsdByRequestType,
    },
    reservations,
    isBounded,
    now: () => Temporal.Instant.fromEpochMilliseconds(clock.now),
  });

  return { service, sumSpendNanoUsdByRequestType, reservations, clock };
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

      await expect(service.assertWithinBudget({ projectId: "proj_1" })).resolves.toBeUndefined();
    });
  });

  describe("when it has spent 1.00 dollars", () => {
    /** @scenario "At the budget a run is refused" */
    /** @scenario "At the budget a synchronous judged query is refused" */
    it("is refused, naming what was spent and the budget", async () => {
      const { service } = serviceWith({ spentNanoUsd: 1 * NANO });

      const error = await service
        .assertWithinBudget({ projectId: "proj_1" })
        .catch((thrown: unknown) => thrown);

      expect((error as { code?: unknown }).code).toBe("instant_eval_free_budget_exhausted");
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
      const { service, sumSpendNanoUsdByRequestType } = serviceWith({
        spentNanoUsd: 1.1 * NANO,
        projects: ["proj_1", "proj_2"],
      });

      expect(await codeOf(() => service.assertWithinBudget({ projectId: "proj_2" }))).toBe(
        "instant_eval_free_budget_exhausted",
      );
      expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledWith({
        tenantIds: ["proj_1", "proj_2"],
        requestType: "instant_eval",
      });
    });
  });

  describe("when the budget is checked twice within a minute", () => {
    /** @scenario "The spend is cached per organization for one minute" */
    it("reads the ledger once, and again once the minute is up", async () => {
      const { service, sumSpendNanoUsdByRequestType, clock } = serviceWith({ spentNanoUsd: 0 });

      await service.assertWithinBudget({ projectId: "proj_1" });
      await service.standing({ projectId: "proj_1" });

      expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledTimes(1);
      clock.now = 60_001;
      await service.standing({ projectId: "proj_1" });
      expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledTimes(2);
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
      const { service, sumSpendNanoUsdByRequestType } = serviceWith({
        spentNanoUsd: 10 * NANO,
        isFree: false,
      });

      await expect(service.assertWithinBudget({ projectId: "proj_1" })).resolves.toBeUndefined();
      expect((await service.standing({ projectId: "proj_1" })).remainingUsd).toBeNull();
      expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
    });
  });

  describe("when a run reserves and releases", () => {
    /** @scenario "A paid organization has no budget" */
    it("holds nothing and refuses nothing", async () => {
      const { service, reservations } = serviceWith({
        isFree: false,
        spentNanoUsd: 10 * NANO,
      });

      await service.reserve({ projectId: "proj_1", reservationId: "run_a", priceUsd: 50 });
      await service.release({ projectId: "proj_1", reservationId: "run_a" });

      await expect(reservations.heldNanoUsd({ organizationId: "org_1" })).resolves.toBe(0);
    });
  });
});

describe("given a free organization with sixty cents of budget left", () => {
  describe("when two runs estimated at forty cents each are accepted together", () => {
    /** @scenario "Runs accepted together share the budget" */
    /** @scenario "A run holds its estimated price when it is accepted" */
    it("holds the first and refuses the second", async () => {
      const { service } = serviceWith({ spentNanoUsd: 0.4 * NANO });

      await expect(
        service.reserve({ projectId: "proj_1", reservationId: "run_a", priceUsd: 0.4 }),
      ).resolves.toBeUndefined();
      const error = await service
        .reserve({ projectId: "proj_1", reservationId: "run_b", priceUsd: 0.4 })
        .catch((thrown: unknown) => thrown);

      expect((error as { code?: unknown }).code).toBe("instant_eval_free_budget_exhausted");
      expect((error as { meta?: { spentUsd?: number } }).meta?.spentUsd).toBeCloseTo(0.8, 6);
    });
  });

  describe("when a run under way checks its next page beside another run's hold", () => {
    /** @scenario "A run under way counts the runs accepted beside it" */
    /** @scenario "A run under way stops when its own judging crosses the budget" */
    it("counts the other hold and not its own", async () => {
      const { service } = serviceWith({ spentNanoUsd: 0.4 * NANO });
      await service.reserve({ projectId: "proj_1", reservationId: "run_a", priceUsd: 0.3 });
      await service.reserve({ projectId: "proj_1", reservationId: "run_b", priceUsd: 0.3 });

      // Spent 0.4, the other run holds 0.3, this run has judged 0.2: 0.9 is
      // under the dollar, so the page goes ahead.
      await expect(
        service.assertWithinBudget({
          projectId: "proj_1",
          reservationId: "run_a",
          inFlightUsd: 0.2,
        }),
      ).resolves.toBeUndefined();

      // Its own hold of 0.3 is not counted twice; with it, 0.4 + 0.3 + 0.3 +
      // 0.2 would already refuse. Judging 0.3 more is what crosses the line.
      expect(
        await codeOf(() =>
          service.assertWithinBudget({
            projectId: "proj_1",
            reservationId: "run_a",
            inFlightUsd: 0.3,
          }),
        ),
      ).toBe("instant_eval_free_budget_exhausted");
    });
  });

  describe("when a run's spend has landed and its hold is released", () => {
    /** @scenario "A hold is released when the run's spend lands" */
    it("frees the budget for the next run and reads the ledger again", async () => {
      const { service, sumSpendNanoUsdByRequestType } = serviceWith({
        spentNanoUsd: 0.4 * NANO,
      });
      await service.reserve({ projectId: "proj_1", reservationId: "run_a", priceUsd: 0.5 });
      const before = sumSpendNanoUsdByRequestType.mock.calls.length;

      await service.release({ projectId: "proj_1", reservationId: "run_a" });

      await expect(
        service.reserve({ projectId: "proj_1", reservationId: "run_b", priceUsd: 0.5 }),
      ).resolves.toBeUndefined();
      expect(sumSpendNanoUsdByRequestType.mock.calls.length).toBe(before + 1);
    });
  });
});

describe("given a deployment that does not bill Instant Evals", () => {
  describe("when a free organization at ten dollars of spend runs one", () => {
    /** @scenario "A paid organization has no budget" */
    it("reads no ledger, holds nothing and refuses nothing", async () => {
      const { service, sumSpendNanoUsdByRequestType, reservations } = serviceWith({
        spentNanoUsd: 10 * NANO,
        isBounded: false,
      });

      await service.reserve({ projectId: "proj_1", reservationId: "run_a", priceUsd: 50 });
      await expect(service.assertWithinBudget({ projectId: "proj_1" })).resolves.toBeUndefined();
      await service.release({ projectId: "proj_1", reservationId: "run_a" });

      expect((await service.standing({ projectId: "proj_1" })).remainingUsd).toBeNull();
      expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
      await expect(reservations.heldNanoUsd({ organizationId: "org_1" })).resolves.toBe(0);
    });
  });
});
