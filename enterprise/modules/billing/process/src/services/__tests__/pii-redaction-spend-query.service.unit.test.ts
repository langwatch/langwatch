/**
 * The PII redaction meter's monthly total: read across the organization's projects, bounded to
 * the month, and skipped rather than zeroed when there is no ledger.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PiiRedactionSpendQueryService } from "../pii-redaction-spend-query.service.ts";

function utcMs(date: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime("UTC").epochMilliseconds;
}

function serviceWith({
  nanoUsd = 0,
  isSpendSourceAvailable = true,
}: { nanoUsd?: number; isSpendSourceAvailable?: boolean } = {}) {
  const sumSpendNanoUsdByRequestType = vi.fn(async () => nanoUsd);
  return {
    sumSpendNanoUsdByRequestType,
    service: PiiRedactionSpendQueryService.create({
      isSpendSourceAvailable: () => isSpendSourceAvailable,
      listProjectIds: async () => ["proj_1", "proj_2"],
      sumSpendNanoUsdByRequestType,
    }),
  };
}

describe("given an organization whose two projects spent 1.10 dollars on PII redaction in February", () => {
  /** @scenario "The spend is read across every project of the organization" */
  it("sums the pii_redaction rows of every project in the month, in meter units", async () => {
    const { service, sumSpendNanoUsdByRequestType } = serviceWith({ nanoUsd: 1_100_000_000 });

    const result = await service.queryPiiRedactionSpendTotal({
      organizationId: "org_1",
      billingMonth: "2026-02",
    });

    expect(result).toEqual({ outcome: "counted", total: 11_000 });
    expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledWith({
      tenantIds: ["proj_1", "proj_2"],
      requestType: "pii_redaction",
      fromMs: utcMs("2026-02-01"),
      toMs: utcMs("2026-03-01"),
    });
  });
});

describe("given a deployment with no spend ledger", () => {
  it("answers unavailable rather than a zero it never read", async () => {
    const { service, sumSpendNanoUsdByRequestType } = serviceWith({
      isSpendSourceAvailable: false,
    });

    expect(
      await service.queryPiiRedactionSpendTotal({
        organizationId: "org_1",
        billingMonth: "2026-02",
      }),
    ).toEqual({ outcome: "unavailable" });
    expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
  });
});
