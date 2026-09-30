// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What the check does about a summary that is behind rather than wrong.
 *
 * The rollup fold and the check that reads it are driven by two independent
 * queues, so a charge landing shortly before the slot can be re-derived by the
 * check while its own projection job is still waiting to run. Nothing here
 * simulates that with a stub: the charges go on the real log, the summary is
 * written by the real projection at the moment the fold would have left it,
 * and the comparator that ships reads both. That is the only way to see the
 * ordering the drift suite cannot — it pre-writes both sides already agreed.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { createLogger } from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWatchHarness } from "./costRollupWatch.integration.harness";
import { NOW, TODAY } from "./costRollupWatch.summary.fixtures";

const h = createWatchHarness({ tenantPrefix: "proj-gov-lag" });

/**
 * The comparator's own logger, reached through the logger cache by name — the
 * same instance the service module captured at import.
 */
const comparatorLogger = createLogger(
  "langwatch:governance:cost-rollup:comparator",
);

/** An hour after the charge the summary has folded, still the same UTC day. */
const LATE_ON_TODAY = NOW + 3_600_000;

const FOLDED_NANO_MINOR = 5_000_000_000;
const LATE_NANO_MINOR = 2_000_000_000;

describe("checking a day whose summary is still catching up", () => {
  beforeEach(() => {
    h.compareWith(h.compareForReal);
  });

  describe("given a charge that landed after the summary was last written", () => {
    /** @scenario A charge the summary has not folded yet is waited for rather than counted as drift */
    it("reports no drift, leaves the comparison to be attempted again, and finds agreement once the rollup catches up", async () => {
      await h.appendObserved({
        costNanoMinor: FOLDED_NANO_MINOR,
        occurredAtMs: NOW,
      });
      await h.appendObserved({
        costNanoMinor: LATE_NANO_MINOR,
        occurredAtMs: LATE_ON_TODAY,
      });
      // The summary exactly as the fold left it, having applied only the first
      // charge — the state the second charge's projection job is queued behind.
      await h.writeSummary({
        amountNanoMinor: FOLDED_NANO_MINOR,
        occurredAtMs: NOW,
      });

      // Scoped to this organization: the lane shares one Postgres and one
      // metric registry, so a system-wide count would read other suites' work.
      const drift = vi.spyOn(comparatorLogger, "error");
      const driftLines = () =>
        drift.mock.calls
          .map(([fields]) => fields as Record<string, unknown>)
          .filter((fields) => fields?.tenantId === h.tenant);

      await h.record(h.charge({ occurredAtMs: LATE_ON_TODAY }));
      await h.runDueCheck();
      await h.drainOutbox();

      // The first look SAW the difference — it is not hidden from anyone — and
      // saw why: the summary's own watermark is older than the charge it is
      // missing. What it did not do is call it drift.
      expect(driftLines()).toEqual([]);
      expect(h.comparisons).toHaveLength(1);
      expect(h.comparisons[0]?.mismatches).toHaveLength(1);
      expect(h.comparisons[0]?.behind).toHaveLength(1);
      expect((await h.messagesFor())[0]?.status).toBe("pending");

      // The projection catches up. Nothing re-marks the day and nothing arms a
      // second check: the comparison already queued is what gets the answer.
      await h.writeSummary({
        amountNanoMinor: FOLDED_NANO_MINOR + LATE_NANO_MINOR,
        occurredAtMs: LATE_ON_TODAY,
      });
      await h.drainThroughRetries({ passes: 1 });
      const linesAfter = driftLines();
      drift.mockRestore();

      expect(linesAfter).toEqual([]);
      expect(h.comparisons).toHaveLength(2);
      expect(h.comparisons[1]?.day).toBe(TODAY);
      expect(h.comparisons[1]?.mismatches).toEqual([]);
      expect(h.comparisons[1]?.behind).toEqual([]);
      expect((await h.messagesFor())[0]?.status).toBe("dispatched");
    });
  });
});
