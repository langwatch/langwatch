// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The two-key split, asserted at the command boundary.
 *
 * The integration suite proves what the LEDGER does with a restatement
 * (`argMax` over `observedAt` picks the newest figure). It cannot prove that a
 * restatement ever REACHES the ledger: a correction deduped at the command
 * boundary never becomes an event, never becomes an intent, and never reaches
 * a write, so the ledger read stays correct about a figure that silently never
 * arrived. That gap is this file.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088 (Decisions 1 and 5).
 */
import { describe, expect, it } from "vitest";

import { RecordPulledUsageCommand } from "../commands";
import type { PulledUsageObservedEventData } from "../schemas/events";

const TENANT = "proj_governance";
const RESTATEMENT_KEY = "sha256-of-the-bucket-coordinates";

/** One observation of one bucket, as the puller seam mints it. */
function observation({
  costNanoMinor,
  observedAtMs,
}: {
  costNanoMinor: number;
  observedAtMs: number;
}): PulledUsageObservedEventData & {
  tenantId: string;
  occurredAt: number;
} {
  return {
    tenantId: TENANT,
    occurredAt: Date.parse("2026-08-01T00:00:00.000Z"),
    itemKey: "usage_report:2026-08-01:1d:claude-sonnet-5:ws_1",
    // Dimension-only, and identical across every version of this bucket —
    // cost is excluded by construction, which is what lets a correction match.
    restatementKey: RESTATEMENT_KEY,
    source: "anthropic_admin",
    ingestionSourceId: "src_1",
    organizationId: "org_acme",
    teamId: "team_platform",
    projectId: null,
    model: "anthropic/claude-sonnet-5",
    tokensInput: 1_000,
    tokensOutput: 200,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    costNanoMinor,
    rateVersion: "registry@2026-08-01",
    costBasis: "computed",
    costStatus: "estimate",
    occurredAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
    observedAtMs,
  };
}

/** The one event the command mints for an observation. */
async function eventFor(data: ReturnType<typeof observation>) {
  const events = await new RecordPulledUsageCommand().handle({
    type: "lw.obs.pulled_usage.record",
    tenantId: TENANT,
    data,
  } as never);
  return events[0]!;
}

/** What the command boundary stamps: the key the event store dedups on. */
async function idempotencyKeyFor(
  data: ReturnType<typeof observation>,
): Promise<string | undefined> {
  return (await eventFor(data)).idempotencyKey;
}

/** The stream a version lands on: every version of one bucket shares it. */
async function aggregateIdFor(
  data: ReturnType<typeof observation>,
): Promise<string> {
  return (await eventFor(data)).aggregateId;
}

describe("recording successive observations of one provider bucket", () => {
  describe("when a provider restates a bucket and then reverts it", () => {
    /**
     * $10 → $12 → $10. The third observation carries the SAME money and the
     * same quantities as the first, so a key built only from content would be
     * byte-identical to it, the command would be deduped, and the ledger would
     * report $12 forever. Money that silently refuses to go back down.
     *
     * Deleting `observedAtMs` from `pulledUsageObservationKey` in commands.ts
     * makes this test fail — that is the whole point of it.
     */
    it("mints a distinct command key per observation, so the revert is not deduped", async () => {
      const keys = await Promise.all([
        idempotencyKeyFor(
          observation({ costNanoMinor: 10_000_000_000, observedAtMs: 1_000 }),
        ),
        idempotencyKeyFor(
          observation({ costNanoMinor: 12_000_000_000, observedAtMs: 2_000 }),
        ),
        idempotencyKeyFor(
          observation({ costNanoMinor: 10_000_000_000, observedAtMs: 3_000 }),
        ),
      ]);

      expect(new Set(keys).size).toBe(3);
      // Specifically the pair that a content-only key would have collapsed.
      expect(keys[2]).not.toBe(keys[0]);
      expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(
        true,
      );
    });

    it("keeps all three versions on one stream, so newest-wins has a stream to win on", async () => {
      const ids = await Promise.all([
        aggregateIdFor(
          observation({ costNanoMinor: 10_000_000_000, observedAtMs: 1_000 }),
        ),
        aggregateIdFor(
          observation({ costNanoMinor: 12_000_000_000, observedAtMs: 2_000 }),
        ),
        aggregateIdFor(
          observation({ costNanoMinor: 10_000_000_000, observedAtMs: 3_000 }),
        ),
      ]);

      // The other half of the split: the aggregate id is the dimension-only
      // restatement key, so a correction lands BEHIND the figure it corrects
      // rather than beside it on a stream of its own.
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe(RESTATEMENT_KEY);
    });
  });

  describe("when the identical observation is replayed", () => {
    it("mints the identical key, so an at-least-once redelivery is a no-op", async () => {
      const once = observation({
        costNanoMinor: 10_000_000_000,
        observedAtMs: 1_000,
      });

      // Same pull, delivered twice by the outbox: same instant, same money.
      expect(await idempotencyKeyFor(once)).toBe(await idempotencyKeyFor(once));
    });
  });

  describe("when only the money changed", () => {
    it("mints a distinct key even at the same observation instant", async () => {
      const at = 5_000;

      expect(
        await idempotencyKeyFor(
          observation({ costNanoMinor: 10_000_000_000, observedAtMs: at }),
        ),
      ).not.toBe(
        await idempotencyKeyFor(
          observation({ costNanoMinor: 12_000_000_000, observedAtMs: at }),
        ),
      );
    });
  });
});
