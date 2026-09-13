// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What the comparison reports when the summary and the charges disagree, and
 * what it leaves behind afterwards — which is nothing.
 *
 * Every scenario here runs the comparator that ships against a real summary in
 * ClickHouse, because a drift count is only real when a real comparison read a
 * real summary. The comparison itself is untouched by the move from a nightly
 * job to a per-charge check; these are the assertions that say so.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { createLogger } from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWatchHarness } from "./costRollupWatch.integration.harness";
import { NOW, TODAY, TONIGHT } from "./costRollupWatch.summary.fixtures";

const h = createWatchHarness({ tenantPrefix: "proj-gov-drift" });

/**
 * The comparator's own logger, reached through the logger cache by name — the
 * same instance the service module captured at import.
 */
const comparatorLogger = createLogger(
  "langwatch:governance:cost-rollup:comparator",
);

describe("finding drift without changing anything", () => {
  beforeEach(() => {
    h.compareWith(h.compareForReal);
  });

  describe("given a day's summary that no longer matches its recorded charges", () => {
    /** @scenario Drift found by a comparison is counted and logged, exactly as before */
    it("counts the drift and names both figures in the log", async () => {
      await h.appendObserved({ costNanoMinor: 5_000_000_000 });
      await h.appendObserved({ costNanoMinor: 7_340_000_000 });
      await h.writeSummary(9_999_000_000);
      // The spy sees the log object before pino serializes it, which is what
      // the line renders — a counter alone cannot say which way drift went.
      const logged = vi.spyOn(comparatorLogger, "error");

      const before = await h.mismatchCount();
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainOutbox();

      expect(await h.mismatchCount()).toBe(before + 1);
      const line = logged.mock.calls
        .map(([fields]) => fields as Record<string, unknown>)
        .find((fields) => fields?.tenantId === h.tenant);
      logged.mockRestore();
      expect(line).toBeDefined();
      expect(line!.day).toBe(TODAY);
      expect(line!.summarized_nano_minor).toBe(9_999_000_000);
      expect(line!.derived_nano_minor).toBe(12_340_000_000);
    });

    /** @scenario Finding drift leaves the summary exactly as it was */
    it("leaves the stored summary alone and records no correcting event", async () => {
      await h.appendObserved({ costNanoMinor: 5_000_000_000 });
      await h.writeSummary(9_999_000_000);
      const summaryBefore = await h.summarizedAmountsFor(TODAY);
      const eventsBefore = await h.eventLogCount();

      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.comparisons[0]?.mismatches).toHaveLength(1);
      expect(await h.summarizedAmountsFor(TODAY)).toEqual(summaryBefore);
      expect(await h.eventLogCount()).toBe(eventsBefore);
    });
  });

  describe("given a day that has already been compared", () => {
    /** @scenario Comparing a day twice over changes nothing that is stored */
    it("reports the same finding the second time and stores nothing", async () => {
      await h.appendObserved({ costNanoMinor: 5_000_000_000 });
      await h.writeSummary(9_999_000_000);
      await h.record(h.charge());
      await h.runDueCheck();
      await h.drainOutbox();
      const summaryAfterFirst = await h.summarizedAmountsFor(TODAY);

      // A new slot, so the second comparison is a new question rather than a
      // repeat the outbox would recognise and suppress.
      h.clock = TONIGHT + 3_600_000;
      await h.record(h.charge({ occurredAtMs: NOW }));
      await h.runDueCheck();
      await h.drainOutbox();

      expect(h.comparisons).toHaveLength(2);
      expect(h.comparisons[1]!.mismatches).toEqual(
        h.comparisons[0]!.mismatches,
      );
      expect(await h.summarizedAmountsFor(TODAY)).toEqual(summaryAfterFirst);
    });
  });
});
