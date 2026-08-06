// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ingest seam prices a pulled usage item exactly once and says, on the
 * record itself, whether the figure is the provider's own or ours.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088 (Decisions 2 and 6).
 */
import { describe, expect, it } from "vitest";

import { pricePulledUsage } from "../services/pulled-usage-pricing.service";

const QUANTITIES = {
  tokensInput: 120_000,
  tokensOutput: 8_000,
  tokensCacheRead: 4_000,
  tokensCacheWrite: 1_000,
};

describe("pricing one pulled usage item", () => {
  describe("when the provider reported its own cost", () => {
    /** @scenario "An exact provider cost is marked exact" */
    it("marks the record exact and carries the provider's figure untouched", () => {
      const priced = pricePulledUsage({
        basis: "provider_reported",
        costUsd: "12.345678901",
        costStatus: "exact",
        quantities: QUANTITIES,
      });

      expect(priced.costStatus).toBe("exact");
      expect(priced.costBasis).toBe("provider_reported");
      // The provider said the number, so no price table produced it and
      // stamping a rate version would claim we derived it.
      expect(priced.rateVersion).toBeNull();
      // Scaled from the decimal string, not the float: 12.345678901 USD is
      // exactly 12_345_678_901 nano-USD and must survive as an integer.
      expect(priced.costNanoUsd).toBe(12_345_678_901);
    });

    /**
     * A provider can report a figure that is still not the invoice — a
     * metered-unit approximation, say. The basis and the status are two
     * different questions, so the adapter answers both.
     */
    it("keeps a provider-reported figure an estimate when the adapter says so", () => {
      const priced = pricePulledUsage({
        basis: "provider_reported",
        costUsd: "3.5",
        costStatus: "estimate",
        quantities: QUANTITIES,
      });

      expect(priced.costBasis).toBe("provider_reported");
      expect(priced.costStatus).toBe("estimate");
      expect(priced.costNanoUsd).toBe(3_500_000_000);
    });
  });

  describe("when the provider gave only quantities", () => {
    /** @scenario "A self-priced usage record is marked estimate" */
    it("prices the quantities once and marks the record estimate", () => {
      const priced = pricePulledUsage({
        basis: "computed",
        model: "anthropic/claude-sonnet-5",
        quantities: QUANTITIES,
      });

      expect(priced.costBasis).toBe("computed");
      expect(priced.costStatus).toBe("estimate");
      expect(priced.costNanoUsd).toBeGreaterThan(0);
      // A computed figure came from a price table, and the record names which.
      expect(priced.rateVersion).toBeTruthy();
    });

    /**
     * The invariant behind the flag: a number WE derived is never the number
     * the provider will invoice, so no input can talk this path into `exact`.
     * The type refuses a costStatus here; this proves the runtime agrees when
     * one is smuggled past it.
     */
    it("cannot be marked exact even when the caller asks for it", () => {
      const priced = pricePulledUsage({
        basis: "computed",
        model: "anthropic/claude-sonnet-5",
        quantities: QUANTITIES,
        costStatus: "exact",
      } as never);

      expect(priced.costStatus).toBe("estimate");
    });

    it("prices an unknown model at zero rather than guessing", () => {
      const priced = pricePulledUsage({
        basis: "computed",
        model: "some-model-nobody-has-a-rate-for",
        quantities: QUANTITIES,
      });

      expect(priced.costNanoUsd).toBe(0);
    });
  });

  describe("when the same item is priced more than once", () => {
    it("returns the identical integer, so no surface can disagree", () => {
      const input = {
        basis: "computed" as const,
        model: "anthropic/claude-sonnet-5",
        quantities: QUANTITIES,
      };

      const first = pricePulledUsage(input);
      const second = pricePulledUsage(input);

      expect(second.costNanoUsd).toBe(first.costNanoUsd);
      expect(second.rateVersion).toBe(first.rateVersion);
      expect(Number.isInteger(first.costNanoUsd)).toBe(true);
    });
  });
});
