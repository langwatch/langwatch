// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's summary seat lane and caveats over the memory twins. @see specs/governance/governance-cost-screen.feature */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { cell, seatPool, setup } from "./governance-cost-summary.fixtures.ts";

const SOURCE = {
  organizationId: "org_1",
  teamId: null,
  traceProjectId: null,
  sourceType: "copilot_studio",
  description: null,
  ingestSecretHash: "hash",
  pullSchedule: null,
  status: "awaiting_first_event",
  createdById: "user_1",
  providerAccountId: null,
} as const;

describe("GovernanceCostSummaryService.summary", () => {
  describe("given pools the licence list does not count as seats", () => {
    /** @scenario "Only pools somebody is paying to seat people in reach the screen" */
    it("leaves out the company-wide, free, dormant and non-seat pools", async () => {
      const pools = [
        seatPool({ skuPartNumber: "Z_SEAT" }),
        seatPool({ skuPartNumber: "A_SEAT" }),
        seatPool({ skuPartNumber: "TENANT_WIDE", perPerson: false }),
        seatPool({ skuPartNumber: "FREE", free: true }),
        seatPool({ skuPartNumber: "DORMANT", live: false }),
        seatPool({ skuPartNumber: "CAPACITY", seatStem: false }),
      ];
      const summary = await setup({ seats: async () => pools }).read();

      expect(summary.seats).toEqual({
        status: "reported",
        pools: [
          { skuPartNumber: "A_SEAT", day: "2026-09-20", seatsBought: 4, seatsAssigned: 2 },
          { skuPartNumber: "Z_SEAT", day: "2026-09-20", seatsBought: 4, seatsAssigned: 2 },
        ],
      });
    });

    /** @scenario "A licence list with nothing countable in it reads as awaiting" */
    it("stays awaiting when no pool survives the count", async () => {
      const summary = await setup({ seats: async () => [seatPool({ free: true })] }).read();

      expect(summary.seats).toEqual({ status: "awaiting_data" });
    });
  });

  describe("given the licence read fails", () => {
    /** @scenario "A seat read that fails degrades only the seat lane" */
    it("says the seat read failed and still returns the cost lanes", async () => {
      const { costRollup, read } = setup({
        seats: async () => {
          throw new Error("ocsf unreachable");
        },
      });
      costRollup.seed(cell({}));

      const summary = await read();

      expect(summary.seats).toEqual({ status: "read_failed" });
      expect(summary.billed.amountUsd).toBe(1);
    });
  });

  describe("given sources that read a window they could not price", () => {
    it("names every affected source and spans the earliest to the latest lost day", async () => {
      const { sources, read } = setup();
      const first = await sources.create({ ...SOURCE, name: "Beta", parserConfig: {} });
      const second = await sources.create({ ...SOURCE, name: "Alpha", parserConfig: {} });
      await sources.updateUnpricedUsageWindow(first.id, {
        since: Temporal.Instant.from("2026-09-03T00:00:00Z"),
        through: null,
      });
      await sources.updateUnpricedUsageWindow(second.id, {
        since: Temporal.Instant.from("2026-09-01T00:00:00Z"),
        through: Temporal.Instant.from("2026-09-02T00:00:00Z"),
      });

      expect((await read()).unpricedWindow).toEqual({
        sinceIso: "2026-09-01T00:00:00.000Z",
        throughIso: "2026-09-03T00:00:00.000Z",
        sourceNames: ["Alpha", "Beta"],
      });
    });
  });

  describe("given a source claiming an Azure subscription", () => {
    it("says nothing while the bill's first read has not finished", async () => {
      const { sources, read } = setup();
      await sources.create({
        ...SOURCE,
        name: "Copilot",
        parserConfig: { azureSubscriptionId: "sub-1" },
      });

      expect((await read()).azureBilling).toBeNull();
    });
  });
});
