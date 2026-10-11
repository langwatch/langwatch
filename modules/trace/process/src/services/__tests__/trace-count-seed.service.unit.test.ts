/** Spec: modules/trace/specs/trace-first-seen.feature */
import { describe, expect, it } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../repositories/memory/memory.trace-usage-count.repository.ts";
import { TraceCountSeedService, type TraceCountSeedReport } from "../trace-count-seed.service.ts";

const HOUR = 3_600_000;
/** The step starts at 14:20 on 8 October; its cut is 15:00. */
const STARTED_AT = Date.UTC(2026, 9, 8, 14, 20);
const CUT = Date.UTC(2026, 9, 8, 15);

type Recorded = Parameters<
  Parameters<typeof TraceCountSeedService.create>[0]["milestones"]["recordTracesCountedBeforeCut"]
>[0];

/** Projects a to e: a and c hold traces this month, d one from last month, e one after the cut. */
function compose({ pageSize = 2 }: { pageSize?: number } = {}) {
  const usageCount = MemoryTraceUsageCountRepository.create();
  const trace = (tenantId: string, traceId: string, createdAt: string) =>
    usageCount.record({ tenantId, traceId, createdAt, occurredAtMs: STARTED_AT });
  trace("a", "a1", "2026-10-01 00:00:00.000");
  trace("a", "a1", "2026-10-02 00:00:00.000");
  trace("a", "a2", "2026-10-08 14:59:59.999");
  trace("c", "c1", "2026-10-05 10:00:00.000");
  trace("d", "d1", "2026-09-30 23:00:00.000");
  trace("d", "d1", "2026-10-03 00:00:00.000");
  trace("e", "e1", "2026-10-08 15:00:00.000");
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
    milestones: { recordTracesCountedBeforeCut: async (data) => void recorded.push(data) },
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
    service.recordCountsBeforeCut({
      resumeFrom,
      dryRun,
      signal,
      onPage: async (report) => void saved.push(report),
    });
  return { run, recorded, saved, pagesAsked, now: () => clock };
}

describe("TraceCountSeedService", () => {
  describe("when the upgrade step records the month before the cut", () => {
    /** @scenario "The upgrade records one count per project for the month before its cut" */
    it("records one fact per project with traces first seen this month before the cut", async () => {
      const { run, recorded, now } = compose();

      const report = await run();

      expect(recorded).toEqual([
        { tenantId: "a", projectId: "a", month: "2026-10", cutAt: CUT, traces: 2 },
        { tenantId: "c", projectId: "c", month: "2026-10", cutAt: CUT, traces: 1 },
      ]);
      expect(report).toMatchObject({ cutAt: CUT, month: "2026-10", projects: 2, traces: 3 });
      expect(now()).toBeGreaterThanOrEqual(CUT);
    });

    /** @scenario "The count's cut falls on the next whole hour, once the old writers are gone" */
    it("cuts on the next whole hour and counts only after the clock has passed it", async () => {
      const { run, recorded } = compose();

      await run();

      expect(CUT - STARTED_AT).toBeLessThan(HOUR);
      expect(recorded.every((fact) => fact.cutAt === CUT)).toBe(true);
    });

    /** @scenario "The upgrade pages projects and saves its cut and each page it completes" */
    it("saves the cut before waiting, then each completed page of projects", async () => {
      const { run, saved, pagesAsked } = compose({ pageSize: 2 });

      await run();

      expect(pagesAsked).toEqual([undefined, "b", "d"]);
      expect(saved.map((report) => report.afterProjectId)).toEqual([null, "b", "d", "e"]);
      expect(saved.every((report) => report.cutAt === CUT)).toBe(true);
    });

    /** @scenario "A resumed upgrade keeps its cut and continues after the saved page" */
    it("continues after the saved project with the saved cut", async () => {
      const { run, recorded, pagesAsked } = compose({ pageSize: 2 });
      const resumeFrom = {
        cutAt: CUT,
        month: "2026-10",
        afterProjectId: "b",
        projects: 1,
        traces: 2,
      };

      const report = await run({ resumeFrom });

      expect(pagesAsked).toEqual(["b", "d"]);
      expect(recorded.map((fact) => fact.projectId)).toEqual(["c"]);
      expect(report).toMatchObject({ projects: 2, traces: 3, afterProjectId: "e" });
    });

    /** @scenario "A dry run of the upgrade records and saves nothing" */
    it("reports the counts so far and records, saves and waits for nothing", async () => {
      const { run, recorded, saved, now } = compose();

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(saved).toEqual([]);
      expect(now()).toBe(STARTED_AT);
      // Counted up to now, 14:20: a2, first seen at 14:59, is not yet in.
      expect(report).toMatchObject({ cutAt: CUT, projects: 2, traces: 2 });
    });

    it("stops before counting when aborted while waiting for the cut", async () => {
      const { run, recorded } = compose();
      const aborted = new AbortController();
      aborted.abort();

      await run({ signal: aborted.signal });

      expect(recorded).toEqual([]);
    });
  });
});
