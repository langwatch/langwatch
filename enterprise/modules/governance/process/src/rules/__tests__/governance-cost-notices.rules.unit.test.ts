// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's summary caveats as pure decisions. @see specs/governance/governance-cost-screen.feature */
import { describe, expect, it } from "vitest";

import {
  azureBillingOf,
  costCaveatsFrom,
  readStoredCostCursor,
} from "../governance-cost-notices.rules.ts";

type Source = Parameters<typeof costCaveatsFrom>[0]["sources"][number];

function staleSourcesFrom(sources: Partial<Source>[]) {
  const full = sources.map((partial) => ({ ...BASE_SOURCE, ...partial }));
  return costCaveatsFrom({ sources: full, unpricedWindows: [], azureBill: undefined }).staleSources;
}

const BASE_SOURCE: Source = {
  id: "src",
  organizationId: "org_1",
  teamId: null,
  sourceType: "copilot_studio",
  name: "",
  description: null,
  ingestSecretHash: "hash",
  parserConfig: {},
  pollerCursor: null,
  errorCount: 0,
  pullSchedule: null,
  status: "active",
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  createdById: null,
};

function source(name: string, lastSuccessAt: string | null, overrides = {}) {
  return {
    name,
    status: "active",
    errorCount: 5,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt) : null,
    ...overrides,
  };
}

const NOTE = {
  isPrepaidDeclared: false,
  hasAzureSpendRows: false,
  costPricedThroughDay: "2026-09-20",
  costHeldSinceMs: null,
};

describe("staleSourcesFrom", () => {
  /** @scenario "The gap is dated from the first source that started failing" */
  it("dates the gap from the first source that started failing, not the last", () => {
    const stale = staleSourcesFrom([
      source("Later", "2026-09-10T00:00:00.000Z"),
      source("Earlier", "2026-09-01T00:00:00.000Z"),
      source("Healthy", "2026-08-01T00:00:00.000Z", { errorCount: 0 }),
    ]);

    expect(stale).toEqual({
      oldestLastSuccessIso: "2026-09-01T00:00:00.000Z",
      sourceNames: ["Earlier", "Later"],
    });
  });

  /** @scenario "A source nobody asked to run is not reported as having stopped" */
  it("leaves a disabled source out", () => {
    expect(
      staleSourcesFrom([source("Off", "2026-09-01T00:00:00.000Z", { status: "disabled" })]),
    ).toBeNull();
  });

  /** @scenario "A source that has never pulled has no day to report" */
  it("leaves out a source that never pulled", () => {
    expect(staleSourcesFrom([source("New", null)])).toBeNull();
  });
});

describe("azureBillingOf", () => {
  it("says nothing when the bill already shows spend", () => {
    expect(azureBillingOf({ ...NOTE, hasAzureSpendRows: true }).azureBilling).toBeNull();
  });

  it("names a held read as a failed billing read", () => {
    expect(azureBillingOf({ ...NOTE, costHeldSinceMs: 1 }).azureBilling).toBe(
      "billing_read_failed",
    );
  });

  it("names a prepaid declaration, and otherwise says no spend was recorded", () => {
    expect(azureBillingOf({ ...NOTE, isPrepaidDeclared: true }).azureBilling).toBe(
      "prepaid_declared",
    );
    expect(azureBillingOf(NOTE).azureBilling).toBe("no_spend_recorded");
  });

  it("says nothing without a claimed bill", () => {
    expect(azureBillingOf(undefined).azureBilling).toBeNull();
  });

  it("waits for the first read to finish", () => {
    expect(azureBillingOf({ ...NOTE, costPricedThroughDay: null }).azureBilling).toBeNull();
  });
});

describe("readStoredCostCursor", () => {
  it("reads the cost position from a stored string or object, and nothing from garbage", () => {
    const stored = { costPricedThroughDay: "2026-09-20", costHeldSinceMs: 7 };

    expect(readStoredCostCursor(JSON.stringify(stored))).toEqual(stored);
    expect(readStoredCostCursor(stored)).toEqual(stored);
    expect(readStoredCostCursor("{not json")).toEqual({
      costPricedThroughDay: null,
      costHeldSinceMs: null,
    });
  });

  it("reads nothing when any other field of the position is malformed, as the puller does", () => {
    const withBadSeats = {
      costPricedThroughDay: "2026-09-20",
      costHeldSinceMs: 7,
      seatsReportedThroughDay: "yesterday",
    };
    const withBadTranscript = {
      costPricedThroughDay: "2026-09-20",
      conversationtranscriptid: "not-a-uuid",
    };

    expect(readStoredCostCursor(withBadSeats)).toEqual({
      costPricedThroughDay: null,
      costHeldSinceMs: null,
    });
    expect(readStoredCostCursor(JSON.stringify(withBadTranscript))).toEqual({
      costPricedThroughDay: null,
      costHeldSinceMs: null,
    });
  });
});
