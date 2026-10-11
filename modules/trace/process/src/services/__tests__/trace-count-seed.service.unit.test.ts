/** Spec: modules/trace/specs/trace-first-seen.feature */
import { describe, expect, it } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../repositories/memory/memory.trace-usage-count.repository.ts";
import { TraceCountMomentService } from "../trace-count-moment.service.ts";
import { TraceCountSeedService, type TraceCountSeedReport } from "../trace-count-seed.service.ts";

/** The step starts once the old writers are gone, 14:20:30 on 8 October. */
const STARTED_AT = Date.UTC(2026, 9, 8, 14, 20, 30);
/** It counts up to a minute later, a moment it stores before counting. */
const COUNTED_UNTIL = Date.UTC(2026, 9, 8, 14, 21, 30);

type Recorded = Parameters<
  Parameters<typeof TraceCountSeedService.create>[0]["milestones"]["recordMonthTracesCounted"]
>[0];

/** Projects a to e: a and c have traces this month, d one from last month, e one after it. */
function compose({ pageSize = 2, stored }: { pageSize?: number; stored?: number } = {}) {
  const usageCount = MemoryTraceUsageCountRepository.create();
  if (stored !== undefined) void usageCount.recordCountMoment({ countedUntil: stored });
  const trace = (tenantId: string, traceId: string, createdAt: string) =>
    usageCount.record({ tenantId, traceId, createdAt, occurredAtMs: STARTED_AT });
  trace("a", "a1", "2026-10-01 00:00:00.000");
  trace("a", "a1", "2026-10-02 00:00:00.000");
  trace("a", "a2", "2026-10-08 14:21:29.999");
  trace("c", "c1", "2026-10-05 10:00:00.000");
  trace("d", "d1", "2026-09-30 23:00:00.000");
  trace("d", "d1", "2026-10-03 00:00:00.000");
  trace("e", "e1", "2026-10-08 14:21:30.000");
  const ids = ["a", "b", "c", "d", "e"];
  const pagesAsked: (string | undefined)[] = [];
  const recorded: Recorded[] = [];
  const saved: TraceCountSeedReport[] = [];
  let clock = STARTED_AT;
  const service = TraceCountSeedService.create({
    projects: {
      listAllIds: async ({ after, limit = ids.length } = {}) => {
        pagesAsked.push(after);
        const rest = ids.filter((id) => after === undefined || id > after);
        const page = rest.slice(0, limit);
        return { ids: page, next: rest.length > limit ? (page.at(-1) ?? null) : null };
      },
    },
    usageCount,
    countMoment: TraceCountMomentService.create({ moments: usageCount }),
    milestones: { recordMonthTracesCounted: async (data) => void recorded.push(data) },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    pageSize,
  });
  const run = ({
    resumeFrom = null,
    dryRun = false,
    signal = new AbortController().signal,
  }: {
    resumeFrom?: TraceCountSeedReport | null;
    dryRun?: boolean;
    signal?: AbortSignal;
  } = {}) =>
    service.recordMonthCounts({
      resumeFrom,
      dryRun,
      signal,
      onPage: async (report) => void saved.push(report),
    });
  const storedMoment = async () => usageCount.findCountMoment();
  return { run, recorded, saved, pagesAsked, now: () => clock, storedMoment };
}

describe("TraceCountSeedService", () => {
  describe("when the upgrade step counts the month", () => {
    /** @scenario "The upgrade records one count per project for the month" */
    it("records one event per project with traces first seen this month before the moment", async () => {
      const { run, recorded, now } = compose();

      const report = await run();

      expect(recorded).toEqual([
        { tenantId: "a", projectId: "a", month: "2026-10", countedUntil: COUNTED_UNTIL, traces: 2 },
        { tenantId: "c", projectId: "c", month: "2026-10", countedUntil: COUNTED_UNTIL, traces: 1 },
      ]);
      expect(report).toMatchObject({ countedUntil: COUNTED_UNTIL, projects: 2, traces: 3 });
      expect(now()).toBeGreaterThanOrEqual(COUNTED_UNTIL);
    });

    /** @scenario "The upgrade stores the moment it counts up to before it counts" */
    it("stores the moment a minute ahead, then waits only until it has settled", async () => {
      const { run, storedMoment, now } = compose();

      await run();

      await expect(storedMoment()).resolves.toEqual([COUNTED_UNTIL]);
      expect(now() - STARTED_AT).toBeLessThanOrEqual(3 * 60_000);
    });

    /** @scenario "A re-run of the upgrade keeps the moment already stored" */
    it("counts up to the stored moment when one exists", async () => {
      const earlier = Date.UTC(2026, 9, 8, 14, 0);
      const { run, recorded, storedMoment } = compose({ stored: earlier });

      await run();

      await expect(storedMoment()).resolves.toEqual([earlier]);
      expect(recorded.every((event) => event.countedUntil === earlier)).toBe(true);
    });

    /** @scenario "The upgrade pages projects and saves its moment and each page it completes" */
    it("saves the moment before waiting, then each completed page of projects", async () => {
      const { run, saved, pagesAsked } = compose({ pageSize: 2 });

      await run();

      expect(pagesAsked).toEqual([undefined, "b", "d"]);
      expect(saved.map((report) => report.afterProjectId)).toEqual([null, "b", "d", "e"]);
      expect(saved.every((report) => report.countedUntil === COUNTED_UNTIL)).toBe(true);
    });

    /** @scenario "A resumed upgrade keeps its moment and continues after the saved page" */
    it("continues after the saved project with the saved moment", async () => {
      const { run, recorded, pagesAsked } = compose({ pageSize: 2 });
      const resumeFrom = {
        countedUntil: COUNTED_UNTIL,
        month: "2026-10",
        afterProjectId: "b",
        projects: 1,
        traces: 2,
      };

      const report = await run({ resumeFrom });

      expect(pagesAsked).toEqual(["b", "d"]);
      expect(recorded.map((event) => event.projectId)).toEqual(["c"]);
      expect(report).toMatchObject({ projects: 2, traces: 3, afterProjectId: "e" });
    });

    /** @scenario "A dry run of the upgrade records, stores and saves nothing" */
    it("reports the counts so far and records, stores, saves and waits for nothing", async () => {
      const { run, recorded, saved, now, storedMoment } = compose();

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(saved).toEqual([]);
      await expect(storedMoment()).resolves.toEqual([]);
      expect(now()).toBe(STARTED_AT);
      // Counted up to now, 14:20:30: a2, first seen at 14:21:29, is not yet in.
      expect(report).toMatchObject({ countedUntil: COUNTED_UNTIL, projects: 2, traces: 2 });
    });

    it("stops before counting when aborted while waiting", async () => {
      const { run, recorded } = compose();
      const aborted = new AbortController();
      aborted.abort();

      await run({ signal: aborted.signal });

      expect(recorded).toEqual([]);
    });
  });
});
