// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Money a provider reports as a credit rather than a charge.
 *
 * Azure serves a refunded day as a negative daily figure, and it is the same
 * field a charge arrives in. Clamping it to zero does not make the books safer
 * — the charge the credit reverses is already recorded, so a dropped credit
 * leaves the customer looking like they spent money the provider gave back.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-128 §3.
 */
import { pulledUsageObservedEventDataSchema } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { describe, expect, it } from "vitest";

import { normalizedPullEventSchema } from "../pullerAdapter";

/** The minimum an adapter event needs to parse, with the cost left open. */
function pullEvent(cost: unknown): Record<string, unknown> {
  return {
    source_event_id: "cost:2026-08-23:Azure Databricks",
    event_timestamp: "2026-08-23T00:00:00.000Z",
    actor: "",
    action: "cost_report",
    target: "Azure Databricks",
    cost_usd: cost,
    raw_payload: "{}",
  };
}

/** The minimum a stored usage event needs, with the money left open. */
function usageEventData(money: number): Record<string, unknown> {
  return {
    itemKey: "cost:2026-08-23:Azure Databricks",
    restatementKey: "a".repeat(64),
    source: "copilot_studio_dataverse",
    ingestionSourceId: "src_1",
    organizationId: "org_acme",
    teamId: null,
    projectId: "proj_governance_acme",
    model: "Azure Databricks",
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    costNanoUsd: money,
    rateVersion: null,
    costBasis: "provider_reported",
    costStatus: "exact",
    occurredAtMs: Date.parse("2026-08-23T00:00:00.000Z"),
    observedAtMs: Date.parse("2026-08-30T09:00:00.000Z"),
  };
}

describe("signed pulled money", () => {
  describe("when a provider reports a day as a credit", () => {
    /** @scenario "A refunded day is recorded as the credit the provider reported" */
    it("keeps the sign on the adapter event", () => {
      const parsed = normalizedPullEventSchema.parse(pullEvent("-1.53352588"));

      expect(parsed.cost_usd).toBe("-1.53352588");
    });

    /** @scenario "A refunded day is recorded as the credit the provider reported" */
    it("keeps the sign on a numeric amount, as Azure sends it", () => {
      const parsed = normalizedPullEventSchema.parse(pullEvent(-0.6));

      expect(parsed.cost_usd).toBe("-0.6");
    });

    /** @scenario "A refunded day is recorded as the credit the provider reported" */
    it("stores the credit on the durable event rather than refusing it", () => {
      const parsed = pulledUsageObservedEventDataSchema.parse(
        usageEventData(-1_533_525_880),
      );

      expect(parsed.costNanoUsd).toBe(-1_533_525_880);
    });
  });

  describe("when the value is not money at all", () => {
    /** @scenario "Widening money to allow credits does not admit values that are not money" */
    it("records zero rather than carrying the unusable value", () => {
      expect(normalizedPullEventSchema.parse(pullEvent("banana")).cost_usd).toBe(
        "0",
      );
      // A lone minus sign matches the pattern's optional-digits shape and is
      // not a number. This is the case that only exists because the sign was
      // allowed, so it is the one the finite check has to catch.
      expect(normalizedPullEventSchema.parse(pullEvent("-")).cost_usd).toBe("0");
      // Matches the pattern, overflows to -Infinity. The check that catches it
      // is the same one the negative clamp used to sit next to.
      expect(normalizedPullEventSchema.parse(pullEvent("-1e999")).cost_usd).toBe(
        "0",
      );
    });

    /** @scenario "Widening money to allow credits does not admit values that are not money" */
    it("refuses a cost that is not a string or a number outright", () => {
      // Refused at the union rather than transformed to "0", which is the
      // pre-existing boundary. Asserted so a later widening of the union does
      // not quietly start carrying these.
      expect(() => normalizedPullEventSchema.parse(pullEvent(Number.NaN))).toThrow();
      expect(() => normalizedPullEventSchema.parse(pullEvent({}))).toThrow();
    });
  });

  describe("when the quantities alongside the money are negative", () => {
    /** @scenario "A refunded day is recorded as the credit the provider reported" */
    it("still refuses a negative token count", () => {
      expect(() =>
        pulledUsageObservedEventDataSchema.parse({
          ...usageEventData(-1_000),
          tokensInput: -1,
        }),
      ).toThrow();
      // Money is signed because a provider can hand back money. A negative
      // count of tokens is not a thing that happened, so widening the money
      // must not widen these with it.
    });
  });
});
