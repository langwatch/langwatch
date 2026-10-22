/**
 * Self-hosted traits as Customer.io receives them.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import { selfHostedTraits } from "../nurturing-customer-io-timestamp.rules.ts";

describe("selfHostedTraits", () => {
  describe("given both ISO dates reported", () => {
    /** @scenario "Customer.io date attributes are sent as Unix seconds" */
    it("decides to send them as Unix seconds", () => {
      const traits = selfHostedTraits({
        self_hosted: true,
        self_hosted_first_seen_at: "2026-10-22T10:13:20.123Z",
        self_hosted_last_report_at: "2026-10-22T10:13:21Z",
      });

      expect(traits).toEqual({
        self_hosted: true,
        self_hosted_first_seen_at: 1_792_664_000,
        self_hosted_last_report_at: 1_792_664_001,
      });
    });
  });

  describe("given no ISO dates reported", () => {
    it("decides to omit both keys rather than send undefined", () => {
      const traits = selfHostedTraits({ self_hosted: true, self_hosted_version: "1.0.0" });

      expect(Object.keys(traits).toSorted()).toEqual(["self_hosted", "self_hosted_version"]);
    });
  });

  describe("given one valid and one malformed ISO date", () => {
    /** @scenario "A malformed self-hosted report date is left out and the rest is still sent" */
    it("decides to omit only the malformed key and keep the rest", () => {
      const traits = selfHostedTraits({
        self_hosted: true,
        self_hosted_version: "1.0.0",
        self_hosted_first_seen_at: "2026-10-22T10:13:20Z",
        self_hosted_last_report_at: "not-a-date",
      });

      expect(traits).toEqual({
        self_hosted: true,
        self_hosted_version: "1.0.0",
        self_hosted_first_seen_at: 1_792_664_000,
      });
    });
  });
});
