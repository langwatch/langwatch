// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The narrowing that lets the agents page tell a refusal from an empty tenant.
 *
 * The assertion that matters is the pair: `listed` and `refused` must come
 * back as different things, because a page that collapses them is the defect
 * this whole read exists to end. Everything else here defends the edges of
 * that pair — an unrecorded listing is neither, an unknown word is neither,
 * and a refusal never picks up a count it does not have.
 */

import { agentsListingOutcome } from "@ee/governance/services/pullers/agentsListingOutcome";
import { describe, expect, it } from "vitest";

const row = (outcome: string | null, reason: string | null) => ({
  LastAgentsListingOutcome: outcome,
  LastAgentsListingReason: reason,
});

describe("given a source's last agents listing", () => {
  describe("when the provider answered", () => {
    it("reports it as listed whether or not the list was empty", () => {
      // The count is not read here on purpose: an empty list is a `listed`
      // outcome with a count of zero, and the outcome alone is what the page
      // branches on.
      expect(agentsListingOutcome(row("listed", null))).toEqual({
        outcome: "listed",
      });
    });
  });

  describe("when the provider refused", () => {
    it("reports a credential problem as one a person must fix", () => {
      expect(agentsListingOutcome(row("refused", "unauthorized"))).toEqual({
        outcome: "refused",
        cause: "access",
      });
    });

    it.each([
      "not_found",
      "not_configured",
    ])("treats %s as a fix rather than a retry", (reason) => {
      expect(agentsListingOutcome(row("refused", reason))).toEqual({
        outcome: "refused",
        cause: "access",
      });
    });

    it.each([
      "rate_limited",
      "unavailable",
      "unreachable",
      "malformed_response",
      "listing_failed",
    ])("treats %s as worth asking again rather than a permission to audit", (reason) => {
      expect(agentsListingOutcome(row("refused", reason))).toEqual({
        outcome: "refused",
        cause: "unreachable",
      });
    });

    /**
     * The reason column is a plain string because the log outlives the
     * vocabulary, so this build will eventually read words written by a later
     * one. Falling to `unreachable` is the safe half of the pair: its advice is
     * "ask again", which sends nobody to audit a permission that was never at
     * fault.
     */
    it("falls to asking again for a reason this build has never heard of", () => {
      expect(
        agentsListingOutcome(row("refused", "quota_exhausted_v2")),
      ).toEqual({ outcome: "refused", cause: "unreachable" });
    });

    it("carries no count, so nothing downstream can read one", () => {
      const outcome = agentsListingOutcome(row("refused", "unauthorized"));

      expect(outcome).not.toHaveProperty("count");
    });
  });

  describe("when the two outcomes are compared", () => {
    /**
     * Stated as its own assertion rather than left implied by the two above.
     * The bug being prevented is a later edit collapsing these into one truthy
     * "we asked" flag, which each individual assertion above would survive.
     */
    it("does not report a refusal as a listing", () => {
      expect(agentsListingOutcome(row("refused", "unauthorized"))).not.toEqual(
        agentsListingOutcome(row("listed", null)),
      );
    });
  });

  describe("when no listing has been recorded", () => {
    /**
     * Null is the reading, not a missing value. A source nobody has asked is a
     * different fact from one that answered with nothing, and returning
     * `listed` here would manufacture an answer no provider gave.
     */
    it.each([
      ["an absent row", undefined],
      ["a row with null columns", row(null, null)],
    ])("reports nothing known for %s", (_name, input) => {
      expect(agentsListingOutcome(input)).toBeNull();
    });

    it("reports nothing known for an outcome word it cannot read", () => {
      expect(agentsListingOutcome(row("partially_listed", null))).toBeNull();
    });
  });
});
