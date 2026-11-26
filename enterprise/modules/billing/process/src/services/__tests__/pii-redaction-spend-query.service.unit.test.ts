/**
 * The PII redaction meter's monthly total: read across the organization's projects, bounded to
 * the month and to the organization's acceptance of the price, and skipped rather than zeroed
 * when there is no ledger.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PiiRedactionSpendQueryService } from "../pii-redaction-spend-query.service.ts";

function utcMs(date: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime("UTC").epochMilliseconds;
}

const instantMs = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

function serviceWith({
  nanoUsd = 0,
  isSpendSourceAvailable = true,
  acceptedAtMs = utcMs("2026-01-15"),
}: { nanoUsd?: number; isSpendSourceAvailable?: boolean; acceptedAtMs?: number | null } = {}) {
  const sumSpendNanoUsdByRequestType = vi.fn(async () => nanoUsd);
  const acceptanceReads: string[] = [];
  return {
    sumSpendNanoUsdByRequestType,
    acceptanceReads,
    service: PiiRedactionSpendQueryService.create({
      isSpendSourceAvailable: () => isSpendSourceAvailable,
      listProjectIds: async () => ["proj_1", "proj_2"],
      findPiiRedactionModelAcceptedAtMs: async ({ organizationId }) => {
        acceptanceReads.push(organizationId);
        return acceptedAtMs;
      },
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
      usageBilledSinceMs: null,
    });

    expect(result).toEqual({ outcome: "counted", total: 11_000 });
    expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledWith({
      tenantIds: ["proj_1", "proj_2"],
      requestType: "pii_redaction",
      fromMs: utcMs("2026-02-01"),
      toMs: utcMs("2026-03-01"),
    });
  });

  /** @scenario "A PII redaction line added mid-month bills only from that moment" */
  it("reads from the moment the PII redaction line was added when that is later", async () => {
    const { service, sumSpendNanoUsdByRequestType } = serviceWith({ nanoUsd: 500_000_000 });
    const lineAddedAtMs = Date.UTC(2026, 1, 10, 9);

    await service.queryPiiRedactionSpendTotal({
      organizationId: "org_1",
      billingMonth: "2026-02",
      usageBilledSinceMs: lineAddedAtMs,
    });

    expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledWith(
      expect.objectContaining({ fromMs: lineAddedAtMs, toMs: utcMs("2026-03-01") }),
    );
  });
});

describe("given an organization whose admin accepted the price during the month", () => {
  /** @scenario "An organization that accepted the price is billed only from the moment it accepted" */
  it("reads the ledger from the moment of acceptance to the month's end", async () => {
    const acceptedAtMs = instantMs("2026-02-10T09:30:00Z");
    const { service, sumSpendNanoUsdByRequestType, acceptanceReads } = serviceWith({
      nanoUsd: 500_000_000,
      acceptedAtMs,
    });

    const result = await service.queryPiiRedactionSpendTotal({
      organizationId: "org_1",
      billingMonth: "2026-02",
    });

    expect(result).toEqual({ outcome: "counted", total: 5_000 });
    expect(acceptanceReads).toEqual(["org_1"]);
    expect(sumSpendNanoUsdByRequestType).toHaveBeenCalledWith({
      tenantIds: ["proj_1", "proj_2"],
      requestType: "pii_redaction",
      fromMs: acceptedAtMs,
      toMs: utcMs("2026-03-01"),
    });
  });
});

describe("given an organization whose admin never accepted the price", () => {
  /** @scenario "An organization that never accepted the price reports no PII redaction spend" */
  it("counts nothing and never reads the ledger", async () => {
    const { service, sumSpendNanoUsdByRequestType } = serviceWith({
      nanoUsd: 1_100_000_000,
      acceptedAtMs: null,
    });

    expect(
      await service.queryPiiRedactionSpendTotal({
        organizationId: "org_1",
        billingMonth: "2026-02",
      }),
    ).toEqual({ outcome: "counted", total: 0 });
    expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
  });
});

describe("given an organization whose admin accepted the price after the month ended", () => {
  /** @scenario "A month that ended before the organization accepted reports no PII redaction spend" */
  it.each([
    { when: "at the next month's first instant", acceptedAtMs: utcMs("2026-03-01") },
    { when: "later still", acceptedAtMs: instantMs("2026-03-05T12:00:00Z") },
  ])(
    "counts nothing for the month, accepted $when, and never reads the ledger",
    async ({ acceptedAtMs }) => {
      const { service, sumSpendNanoUsdByRequestType } = serviceWith({
        nanoUsd: 1_100_000_000,
        acceptedAtMs,
      });

      expect(
        await service.queryPiiRedactionSpendTotal({
          organizationId: "org_1",
          billingMonth: "2026-02",
        }),
      ).toEqual({ outcome: "counted", total: 0 });
      expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
    },
  );
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
        usageBilledSinceMs: null,
      }),
    ).toEqual({ outcome: "unavailable" });
    expect(sumSpendNanoUsdByRequestType).not.toHaveBeenCalled();
  });
});
