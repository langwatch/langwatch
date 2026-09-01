// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ingest seam turning one adapter event into one priced usage record.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088 (Decisions 1, 4 and 5).
 */
import { describe, expect, it } from "vitest";
import {
  buildPulledUsageRecord,
  type PulledUsageSourceAttribution,
} from "../pulledUsageRecord";
import type { NormalizedPullEvent } from "../pullerAdapter";

const SOURCE: PulledUsageSourceAttribution = {
  ingestionSourceId: "src_1",
  sourceType: "anthropic_admin",
  organizationId: "org_acme",
  teamId: "team_platform",
};

/** The org's hidden governance project — where the row is stored (ADR-128). */
const GOV_PROJECT_ID = "proj_governance_acme";

const OBSERVED_AT = new Date("2026-08-06T09:00:00.000Z");

function usageEvent({
  overrides = {},
  hint = {},
}: {
  overrides?: Partial<NormalizedPullEvent>;
  hint?: Record<string, unknown>;
} = {}): NormalizedPullEvent {
  return {
    source_event_id: "usage_report:2026-08-01:1d:claude-sonnet-5:ws_1",
    event_timestamp: "2026-08-01T00:00:00.000Z",
    actor: "",
    action: "usage_report",
    target: "anthropic/claude-sonnet-5",
    cost_usd: "0",
    tokens_input: 120_000,
    tokens_output: 8_000,
    raw_payload: "{}",
    extra: {
      pulled_usage: {
        costBasis: "computed",
        dimensions: {
          granularity: "1d",
          model: "anthropic/claude-sonnet-5",
          workspaceId: "ws_1",
        },
        model: "anthropic/claude-sonnet-5",
        ...hint,
      },
    },
    ...overrides,
  };
}

describe("building one pulled usage record", () => {
  describe("when the adapter declared a usage item", () => {
    it("carries the priced figure, the coordinates and both times", () => {
      const record = buildPulledUsageRecord({
        event: usageEvent(),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(record).not.toBeNull();
      expect(record?.source).toBe("anthropic_admin");
      expect(record?.model).toBe("anthropic/claude-sonnet-5");
      expect(record?.costBasis).toBe("computed");
      expect(record?.costStatus).toBe("estimate");
      expect(record?.costNanoMinor).toBeGreaterThan(0);
      expect(record?.rateVersion).toBeTruthy();
      // The bucket is the provider's; the observation is ours.
      expect(record?.occurredAtMs).toBe(Date.parse("2026-08-01T00:00:00.000Z"));
      expect(record?.observedAtMs).toBe(OBSERVED_AT.getTime());
    });

    it("attributes to the source's own organization and team", () => {
      const record = buildPulledUsageRecord({
        event: usageEvent(),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(record?.organizationId).toBe("org_acme");
      expect(record?.teamId).toBe("team_platform");
    });

    it("keeps the organization and leaves the team empty", () => {
      const record = buildPulledUsageRecord({
        event: usageEvent(),
        source: { ...SOURCE, teamId: null },
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      // The half the name claims and the assertions used to omit: losing the
      // team must not lose the organization too, or the cost is unattributed
      // outright rather than attributed one level up.
      expect(record?.organizationId).toBe("org_acme");
      expect(record?.teamId).toBeNull();
      // The home is where the row is stored, and it does not move with the
      // owner: a source that names no team still lands under the org's
      // governance project, and the money still belongs to the org.
      expect(record?.projectId).toBe(GOV_PROJECT_ID);
    });

    it("stores the row under the governance home without attributing to it", () => {
      const record = buildPulledUsageRecord({
        event: usageEvent(),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(record?.projectId).toBe(GOV_PROJECT_ID);
      // The two must not collapse into one another: a home that also became
      // the owner would file a customer's money where they cannot see it.
      expect(record?.organizationId).toBe("org_acme");
      expect(record?.teamId).toBe("team_platform");
      expect(record?.teamId).not.toBe(GOV_PROJECT_ID);
      expect(record?.organizationId).not.toBe(GOV_PROJECT_ID);
    });

    it("carries a provider-reported cost as exact when the adapter says so", () => {
      const record = buildPulledUsageRecord({
        event: usageEvent({
          overrides: {
            cost_usd: "42.5",
            action: "cost_report",
            tokens_input: 0,
            tokens_output: 0,
          },
          hint: { costBasis: "provider_reported", costStatus: "exact" },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(record?.costBasis).toBe("provider_reported");
      expect(record?.costStatus).toBe("exact");
      expect(record?.costNanoMinor).toBe(42_500_000_000);
      expect(record?.rateVersion).toBeNull();
    });

    it("prefers the adapter's exact decimal string over the float cost_usd", () => {
      const record = buildPulledUsageRecord({
        event: usageEvent({
          // What the canonical `cost_usd: number` field could still carry
          // after a provider's string went through a JS float.
          overrides: { cost_usd: "1.1", action: "cost_report" },
          hint: {
            costBasis: "provider_reported",
            costStatus: "exact",
            costUsd: "1.100000001",
          },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(record?.costNanoMinor).toBe(1_100_000_001);
    });
  });

  describe("when the same period is pulled again", () => {
    it("keeps the restatement key identical though the cost changed", () => {
      const first = buildPulledUsageRecord({
        event: usageEvent(),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const corrected = buildPulledUsageRecord({
        event: usageEvent({
          overrides: {
            cost_usd: "99",
            tokens_input: 999_999,
            tokens_output: 999_999,
          },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: new Date("2026-08-07T09:00:00.000Z"),
      });

      // The whole correction mechanic: the key a restatement must MATCH
      // cannot move when the money moves, or the correction would be added
      // beside the figure it corrects instead of replacing it.
      expect(corrected?.restatementKey).toBe(first?.restatementKey);
      expect(corrected?.costNanoMinor).not.toBe(first?.costNanoMinor);
      expect(corrected?.observedAtMs).toBeGreaterThan(first!.observedAtMs);
    });

    /** @scenario "The hour's context never changes which record a correction lands on" */
    it("keeps the restatement key identical though the hour's context changed", () => {
      // Display-only context rides on `extra` BESIDE the hint, never in it.
      // Late-arriving statements grow an hour's executed-time total, so a
      // re-read recomputes it — keyed, that correction would mint a second
      // record and the ledger would count the question twice.
      const withHour = (totalExecutionMs: string): NormalizedPullEvent => {
        const event = usageEvent();
        return {
          ...event,
          extra: {
            ...event.extra,
            warehouseHour: { totalExecutionMs, billableUsd: "6" },
          },
        };
      };

      const first = buildPulledUsageRecord({
        event: withHour("60000"),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const corrected = buildPulledUsageRecord({
        event: withHour("3600000"),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: new Date("2026-08-07T09:00:00.000Z"),
      });

      expect(corrected?.restatementKey).toBe(first?.restatementKey);
    });

    it("mints a different key when a coordinate actually differs", () => {
      const base = buildPulledUsageRecord({
        event: usageEvent(),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const otherWorkspace = buildPulledUsageRecord({
        event: usageEvent({
          hint: {
            dimensions: {
              granularity: "1d",
              model: "anthropic/claude-sonnet-5",
              workspaceId: "ws_2",
            },
          },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const otherPeriod = buildPulledUsageRecord({
        event: usageEvent({
          overrides: { event_timestamp: "2026-08-02T00:00:00.000Z" },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(otherWorkspace?.restatementKey).not.toBe(base?.restatementKey);
      expect(otherPeriod?.restatementKey).not.toBe(base?.restatementKey);
    });

    it("keeps two sources apart even on identical coordinates", () => {
      const a = buildPulledUsageRecord({
        event: usageEvent(),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const b = buildPulledUsageRecord({
        event: usageEvent(),
        source: { ...SOURCE, ingestionSourceId: "src_2" },
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(b?.restatementKey).not.toBe(a?.restatementKey);
    });

    it("does not depend on the order the adapter listed its dimensions", () => {
      const a = buildPulledUsageRecord({
        event: usageEvent({
          hint: {
            dimensions: { model: "m", workspaceId: "w", granularity: "1d" },
          },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const b = buildPulledUsageRecord({
        event: usageEvent({
          hint: {
            dimensions: { granularity: "1d", workspaceId: "w", model: "m" },
          },
        }),
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      expect(b?.restatementKey).toBe(a?.restatementKey);
    });
  });

  describe("when the event is not a usage item", () => {
    it("returns nothing for a plain audit event", () => {
      const auditOnly = usageEvent();
      auditOnly.extra = { something_else: true };

      expect(
        buildPulledUsageRecord({
          event: auditOnly,
          source: SOURCE,
          governanceProjectId: GOV_PROJECT_ID,
          observedAt: OBSERVED_AT,
        }),
      ).toBeNull();
    });

    it("returns nothing when the adapter carried no extra at all", () => {
      const auditOnly = usageEvent();
      auditOnly.extra = undefined;

      expect(
        buildPulledUsageRecord({
          event: auditOnly,
          source: SOURCE,
          governanceProjectId: GOV_PROJECT_ID,
          observedAt: OBSERVED_AT,
        }),
      ).toBeNull();
    });
  });

  describe("when the adapter declared usage but supplied it badly", () => {
    it("refuses an unparseable bucket time instead of filing money under now", () => {
      expect(() =>
        buildPulledUsageRecord({
          event: usageEvent({ overrides: { event_timestamp: "not-a-date" } }),
          source: SOURCE,
          governanceProjectId: GOV_PROJECT_ID,
          observedAt: OBSERVED_AT,
        }),
      ).toThrow(/timestamp/i);
    });

    it("refuses a hint that names no dimensions to key on", () => {
      expect(() =>
        buildPulledUsageRecord({
          event: usageEvent({ hint: { dimensions: {} } }),
          source: SOURCE,
          governanceProjectId: GOV_PROJECT_ID,
          observedAt: OBSERVED_AT,
        }),
      ).toThrow();
    });

    it("refuses a provider-reported cost with no status declared", () => {
      expect(() =>
        buildPulledUsageRecord({
          event: usageEvent({
            overrides: { cost_usd: "1" },
            hint: { costBasis: "provider_reported" },
          }),
          source: SOURCE,
          governanceProjectId: GOV_PROJECT_ID,
          observedAt: OBSERVED_AT,
        }),
      ).toThrow();
    });
  });
});
