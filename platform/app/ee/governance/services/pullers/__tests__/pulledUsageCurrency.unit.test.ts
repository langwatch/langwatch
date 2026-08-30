// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The currency a provider billed in, carried from the adapter to the durable
 * event without a rate ever being applied.
 *
 * ADR-128 §3: money is an integer of minor units plus a currency code, and we
 * never invent an exchange rate. When the biller publishes its own converted
 * dollar figure we store that as a second number; when it does not, the dollar
 * column is absent rather than zero.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-128 §3.
 */
import { pulledUsageObservedEventDataSchema } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { describe, expect, it } from "vitest";

import {
  buildPulledUsageRecord,
  type PulledUsageSourceAttribution,
} from "../pulledUsageRecord";
import type { NormalizedPullEvent } from "../pullerAdapter";

const SOURCE: PulledUsageSourceAttribution = {
  ingestionSourceId: "src_1",
  sourceType: "copilot_studio_dataverse",
  organizationId: "org_acme",
  teamId: null,
};

const GOV_PROJECT_ID = "proj_governance_acme";
const OBSERVED_AT = new Date("2026-08-30T09:00:00.000Z");

function costEvent(hint: Record<string, unknown>): NormalizedPullEvent {
  return {
    source_event_id: "azure_cost:2026-08-23:Azure Databricks",
    event_timestamp: "2026-08-23T00:00:00.000Z",
    actor: "",
    action: "cost_report",
    target: "Azure Databricks",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: "{}",
    extra: {
      pulled_usage: {
        costBasis: "provider_reported",
        costStatus: "exact",
        dimensions: {
          granularity: "1d",
          meterCategory: "Azure Databricks",
          subscriptionId: "sub_1",
        },
        model: "Azure Databricks",
        ...hint,
      },
    },
  };
}

function record(hint: Record<string, unknown>) {
  return buildPulledUsageRecord({
    event: costEvent(hint),
    source: SOURCE,
    governanceProjectId: GOV_PROJECT_ID,
    observedAt: OBSERVED_AT,
  });
}

describe("currency on a pulled usage record", () => {
  describe("when the provider bills in a currency other than dollars", () => {
    /** @scenario "A record from a provider that bills in another currency says which" */
    it("carries that currency alongside the amount", () => {
      const built = record({ costUsd: "1.53352588", currency: "EUR" });

      expect(built?.currencyCode).toBe("EUR");
      // The provider's own figure, scaled but never converted.
      expect(built?.costNanoMinor).toBe(1_533_525_880);
    });

    /** @scenario "A record from a provider that bills in another currency says which" */
    it("states no dollar figure when the biller published none", () => {
      const built = record({ costUsd: "1.53352588", currency: "EUR" });

      expect(built?.costNanoUsd).toBe(null);
    });

    /** @scenario "The biller's own dollar conversion is what the dollar figure reports" */
    it("carries the biller's own dollar figure when it published one", () => {
      const built = record({
        costUsd: "1.53352588",
        currency: "EUR",
        costUsdBiller: "1.74538248",
      });

      expect(built?.costNanoMinor).toBe(1_533_525_880);
      expect(built?.costNanoUsd).toBe(1_745_382_480);
      // Not derivable from the amount above by any rate this code holds: it is
      // a second number the biller stated, carried verbatim.
    });
  });

  describe("when the provider names no currency", () => {
    /** @scenario "A record whose provider states no currency is treated as dollars" */
    it("treats the money as dollars", () => {
      const built = record({ costUsd: "2.50" });

      expect(built?.currencyCode).toBe("USD");
    });

    /** @scenario "A record whose provider states no currency is treated as dollars" */
    it("needs no separate biller conversion to be stated in dollars", () => {
      const built = record({ costUsd: "2.50" });

      // The amount IS the dollar amount, so a second column would restate it.
      expect(built?.costNanoMinor).toBe(2_500_000_000);
      expect(built?.costNanoUsd).toBe(null);
    });
  });

  describe("when a record was written before money carried a currency", () => {
    /** @scenario "Records already on the durable log still read after the change" */
    it("still parses, and reads as dollars with no biller conversion", () => {
      // Verbatim shape of an event already on the durable log: the money under
      // its old name, and neither of the two new fields present.
      const onTheLog = {
        itemKey: "usage_report:2026-08-01:1d",
        restatementKey: "b".repeat(64),
        source: "anthropic_admin",
        ingestionSourceId: "src_1",
        organizationId: "org_acme",
        teamId: "team_platform",
        projectId: "proj_governance_acme",
        model: "anthropic/claude-sonnet-5",
        tokensInput: 1_000,
        tokensOutput: 200,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        costNanoMinor: 12_340_000_000,
        rateVersion: null,
        costBasis: "provider_reported",
        costStatus: "exact",
        occurredAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
        observedAtMs: Date.parse("2026-08-02T04:00:00.000Z"),
      };

      const parsed = pulledUsageObservedEventDataSchema.parse(onTheLog);

      expect(parsed.currencyCode).toBe("USD");
      expect(parsed.costNanoUsd).toBe(null);
      expect(parsed.costNanoMinor).toBe(12_340_000_000);
    });

    /** @scenario "Records already on the durable log still read after the change" */
    it("refuses a currency code that is not three letters", () => {
      expect(() =>
        pulledUsageObservedEventDataSchema.parse({
          itemKey: "k",
          restatementKey: "c".repeat(64),
          source: "s",
          ingestionSourceId: "src_1",
          organizationId: "org_acme",
          teamId: null,
          projectId: "proj_governance_acme",
          model: "m",
          tokensInput: 0,
          tokensOutput: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costNanoMinor: 1,
          currencyCode: "EUROS",
          rateVersion: null,
          costBasis: "provider_reported",
          costStatus: "exact",
          occurredAtMs: 1,
          observedAtMs: 1,
        }),
      ).toThrow();
    });
  });

  describe("when the credit and the charge are in the same currency", () => {
    /** @scenario "A refunded day is recorded as the credit the provider reported" */
    it("keeps the sign through the currency plumbing", () => {
      const built = record({ costUsd: "-1.53352588", currency: "EUR" });

      expect(built?.costNanoMinor).toBe(-1_533_525_880);
      expect(built?.currencyCode).toBe("EUR");
    });

    /** @scenario "The biller's own dollar conversion is what the dollar figure reports" */
    it("keeps the sign on the biller's dollar figure too", () => {
      const built = record({
        costUsd: "-1.53352588",
        currency: "EUR",
        costUsdBiller: "-1.74538248",
      });

      expect(built?.costNanoUsd).toBe(-1_745_382_480);
    });
  });
});
