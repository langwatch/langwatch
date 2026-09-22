/**
 * The Instant Evals meter's monthly total: read across the organization's
 * projects, bounded to the month, and skipped rather than zeroed when there
 * is no ledger. @see specs/instant-evals/instant-eval-billing.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  instantEvalMeterUnitsToUsd,
  nanoUsdToInstantEvalMeterUnits,
} from "../../rules/instant-eval-meter.rules.ts";
import { InstantEvalSpendQueryService } from "../instant-eval-spend-query.service.ts";

function utcMs(date: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime("UTC").epochMilliseconds;
}

function serviceWith({
  nanoUsd = 0,
  isSpendSourceAvailable = true,
  projects = ["proj_1", "proj_2"],
}: {
  nanoUsd?: number;
  isSpendSourceAvailable?: boolean;
  projects?: string[];
} = {}) {
  const sumSpendNanoUsdByRequestType = vi.fn(async () => nanoUsd);

  return {
    sumSpendNanoUsdByRequestType,
    service: InstantEvalSpendQueryService.create({
      isSpendSourceAvailable: () => isSpendSourceAvailable,
      listProjectIds: async () => projects,
      sumSpendNanoUsdByRequestType,
    }),
  };
}

describe("given an organization that judged 1.23455 dollars in February", () => {
  describe("when the month's meter total is read", () => {
    /** @scenario "The value is the month's price in dollars to four places" */
    it("counts every project, bounds the month, and truncates to meter units", async () => {
      const { service, sumSpendNanoUsdByRequestType } = serviceWith({
        nanoUsd: 1_234_550_000,
      });

      const result = await service.queryInstantEvalSpendTotal({
        organizationId: "org_1",
        billingMonth: "2026-02",
      });

      expect(result).toEqual({ outcome: "counted", total: 12_345 });
      expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledWith({
        tenantIds: ["proj_1", "proj_2"],
        requestType: "instant_eval",
        fromMs: utcMs("2026-02-01"),
        toMs: utcMs("2026-03-01"),
      });
      expect(instantEvalMeterUnitsToUsd(12_345)).toBe(1.2345);
    });
  });
});

describe("given a deployment with no spend ledger", () => {
  describe("when the month's meter total is read", () => {
    /** @scenario "A month with no Instant Eval spend reports nothing on that meter" */
    it("answers unavailable rather than a zero it never read", async () => {
      const { service, sumSpendNanoUsdByRequestType } = serviceWith({
        isSpendSourceAvailable: false,
      });

      expect(
        await service.queryInstantEvalSpendTotal({
          organizationId: "org_1",
          billingMonth: "2026-02",
        }),
      ).toEqual({ outcome: "unavailable" });
      expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
    });
  });
});

describe("given a fraction of a meter unit", () => {
  describe("when it is converted", () => {
    /** @scenario "The value is the month's price in dollars to four places" */
    it("is never billed, and a whole unit round-trips", () => {
      expect(nanoUsdToInstantEvalMeterUnits(99_999)).toBe(0);
      expect(nanoUsdToInstantEvalMeterUnits(100_000)).toBe(1);
      expect(instantEvalMeterUnitsToUsd(1)).toBe(0.0001);
      expect(instantEvalMeterUnitsToUsd(10_000)).toBe(1);
    });
  });
});
