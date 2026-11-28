/**
 * The storage line under the upgrade dialog's retention picker.
 * @see specs/billing/retention-at-upgrade.feature
 */
import { Currency } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import { retentionStorageLine, type RetentionEstimateState } from "../retention-choice.ts";

const GB = 1_000_000_000;
const loading: RetentionEstimateState = { status: "loading" };
const ready = (totalBytes: number, coveredDays: number): RetentionEstimateState => ({
  status: "ready",
  estimate: { totalBytes, coveredDays },
});

describe("retentionStorageLine()", () => {
  describe("given a retention of 90 days or less", () => {
    it("is included in Growth at 90 days", () => {
      expect(
        retentionStorageLine({ retentionDays: 91, currency: Currency.EUR, estimate: loading }),
      ).toEqual({ kind: "included" });
    });

    /** @scenario "A shorter retention is included too" */
    it("is included in Growth at 30 days", () => {
      expect(
        retentionStorageLine({
          retentionDays: 35,
          currency: Currency.EUR,
          estimate: ready(49 * GB, 49),
        }),
      ).toEqual({ kind: "included" });
    });
  });

  describe("given a retention longer than 90 days", () => {
    /** @scenario "A longer retention shows the storage line while the estimate loads" */
    it("shows the unit price while the storage read loads", () => {
      expect(
        retentionStorageLine({ retentionDays: 371, currency: Currency.EUR, estimate: loading }),
      ).toEqual({ kind: "loading", unitPrice: "€3 per GB a month" });
    });

    /** @scenario "A longer retention shows a monthly estimate from today's storage" */
    it("estimates the GB above 90 days from the daily rate", () => {
      expect(
        retentionStorageLine({
          retentionDays: 182,
          currency: Currency.EUR,
          estimate: ready(49 * GB, 49),
        }),
      ).toEqual({
        kind: "estimate",
        unitPrice: "€3 per GB a month",
        amount: "About 91 GB, about €273 a month",
      });
    });

    it("says less than 1 GB for a tiny organization", () => {
      const line = retentionStorageLine({
        retentionDays: 182,
        currency: Currency.EUR,
        estimate: ready(0.1 * GB, 49),
      });

      expect(line).toMatchObject({ kind: "estimate", amount: "Less than 1 GB, about €3 a month" });
    });

    /** @scenario "A failed storage read still shows the unit price" */
    it("keeps only the unit price when the storage read failed", () => {
      expect(
        retentionStorageLine({
          retentionDays: 371,
          currency: Currency.EUR,
          estimate: { status: "failed" },
        }),
      ).toEqual({ kind: "unitOnly", unitPrice: "€3 per GB a month" });
    });

    /** @scenario "Dollar customers see the dollar price" */
    it("prices dollar customers at $4 per GB", () => {
      expect(
        retentionStorageLine({ retentionDays: 371, currency: Currency.USD, estimate: loading }),
      ).toEqual({ kind: "loading", unitPrice: "$4 per GB a month" });
    });
  });
});
