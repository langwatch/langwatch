/** Spec: modules/trace/specs/trace-month-trace-ids.feature */
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceUsageCountRepository } from "../../repositories/memory/memory.trace-usage-count.repository.ts";
import {
  ORPHAN_IDS_REPORTED,
  TraceMonthIdsMigrationService,
  traceMonthIdsReportSchema,
  type TraceMonthIdsReport,
} from "../trace-month-ids-migration.service.ts";

/** The step starts at 14:20:30 on 8 October. */
const STARTED_AT = Date.UTC(2026, 9, 8, 14, 20, 30);
const MONTH_START = Date.UTC(2026, 9, 1);

type Recorded = Parameters<
  Parameters<typeof TraceMonthIdsMigrationService.create>[0]["milestones"]["recordMonthTraceIds"]
>[0];

/** Projects a to e: a has three traces this month, c one, d one from last month, e one after. */
function compose({
  pageSize = 2,
  traceIdPageSize = 2,
  orphans = [] as readonly string[],
}: { pageSize?: number; traceIdPageSize?: number; orphans?: readonly string[] } = {}) {
  const usageCount = MemoryTraceUsageCountRepository.create();
  const trace = (tenantId: string, traceId: string, createdAt: string) =>
    usageCount.record({ tenantId, traceId, createdAt, occurredAtMs: STARTED_AT });
  trace("a", "a1", "2026-10-01 00:00:00.000");
  trace("a", "a1", "2026-10-02 00:00:00.000");
  trace("a", "a2", "2026-10-08 14:20:29.999");
  trace("a", "a3", "2026-10-03 09:00:00.000");
  trace("c", "c1", "2026-10-05 10:00:00.000");
  trace("d", "d1", "2026-09-30 23:00:00.000");
  trace("d", "d1", "2026-10-03 00:00:00.000");
  trace("e", "e1", "2026-10-08 14:20:30.000");
  const ids = ["a", "b", "c", "d", "e", ...orphans].toSorted();
  const pagesAsked: (string | undefined)[] = [];
  const recorded: Recorded[] = [];
  const saved: TraceMonthIdsReport[] = [];
  const tenantsRead: string[] = [];
  const logger = { warn: vi.fn() };
  const service = TraceMonthIdsMigrationService.create({
    projects: {
      listAllWithOrganization: async ({ after, limit = ids.length } = {}) => {
        pagesAsked.push(after);
        const rest = ids.filter((id) => after === undefined || id > after);
        const page = rest.slice(0, limit);
        return {
          projects: page
            .filter((id) => !orphans.includes(id))
            .map((id) => ({ id, organizationId: "org-1" })),
          orphanIds: page.filter((id) => orphans.includes(id)),
          next: rest.length > limit ? (page.at(-1) ?? null) : null,
        };
      },
    },
    usageCount: {
      findTraceIdsFirstSeen: (input) => {
        tenantsRead.push(input.tenantId);
        return usageCount.findTraceIdsFirstSeen(input);
      },
    },
    logger,
    milestones: { recordMonthTraceIds: async (data) => void recorded.push(data) },
    now: () => STARTED_AT,
    pageSize,
    traceIdPageSize,
  });
  const run = ({
    resumeFrom = null,
    dryRun = false,
    signal = new AbortController().signal,
  }: {
    resumeFrom?: TraceMonthIdsReport | null;
    dryRun?: boolean;
    signal?: AbortSignal;
  } = {}) =>
    service.sendMonthTraceIds({
      resumeFrom,
      dryRun,
      signal,
      onPage: async (report) => void saved.push(report),
    });
  return { run, recorded, saved, pagesAsked, tenantsRead, logger };
}

const REPORT_BASE = {
  month: "2026-10",
  fromMs: MONTH_START,
  toMs: STARTED_AT,
  skippedOrphans: 0,
  orphanProjectIds: [] as string[],
  orphansCountedThrough: null,
};

describe("TraceMonthIdsMigrationService", () => {
  describe("when the upgrade step sends the month's trace ids", () => {
    /** @scenario "The upgrade sends each project's trace ids for the month in pages" */
    it("records one event per page of trace ids first seen this month before the start", async () => {
      const { run, recorded } = compose();

      const report = await run();

      expect(recorded).toEqual([
        { tenantId: "a", projectId: "a", month: "2026-10", traceIds: ["a1", "a2"] },
        { tenantId: "a", projectId: "a", month: "2026-10", traceIds: ["a3"] },
        { tenantId: "c", projectId: "c", month: "2026-10", traceIds: ["c1"] },
      ]);
      expect(report).toMatchObject({ ...REPORT_BASE, projects: 2, traceIds: 4, events: 3 });
    });

    /** @scenario "The upgrade saves its progress after every page of trace ids and every project" */
    it("saves the last trace id after each page and each project once done", async () => {
      const { run, saved, pagesAsked } = compose();

      await run();

      expect(pagesAsked).toEqual([undefined, "b", "d"]);
      expect(saved.map(({ afterProjectId, inProject }) => ({ afterProjectId, inProject }))).toEqual(
        [
          { afterProjectId: null, inProject: { projectId: "a", afterTraceId: "a2" } },
          { afterProjectId: null, inProject: { projectId: "a", afterTraceId: "a3" } },
          { afterProjectId: "a", inProject: null },
          { afterProjectId: "b", inProject: null },
          { afterProjectId: "b", inProject: { projectId: "c", afterTraceId: "c1" } },
          { afterProjectId: "c", inProject: null },
          { afterProjectId: "d", inProject: null },
          { afterProjectId: "e", inProject: null },
        ],
      );
    });

    /** @scenario "A resumed upgrade continues inside the project it stopped in" */
    it("continues after the saved trace id with the saved window", async () => {
      const { run, recorded, pagesAsked } = compose();
      const resumeFrom: TraceMonthIdsReport = {
        ...REPORT_BASE,
        toMs: STARTED_AT - 1,
        afterProjectId: null,
        inProject: { projectId: "a", afterTraceId: "a1" },
        projects: 1,
        traceIds: 1,
        events: 1,
      };

      const report = await run({ resumeFrom });

      expect(pagesAsked[0]).toBeUndefined();
      // The saved window ends just before a2 was first seen, so a2 stays out.
      expect(recorded.map((event) => event.traceIds)).toEqual([["a3"], ["c1"]]);
      expect(report).toMatchObject({ toMs: STARTED_AT - 1, projects: 2, traceIds: 3, events: 3 });
    });

    /** @scenario "The upgrade skips a project no organisation owns" */
    it("completes past an orphan without reading its traces, counting and naming it", async () => {
      const { run, recorded, tenantsRead, logger } = compose({ orphans: ["bb"] });

      const report = await run();

      expect(tenantsRead).not.toContain("bb");
      expect(recorded.map((event) => event.projectId)).toEqual(["a", "a", "c"]);
      expect(report).toMatchObject({
        projects: 2,
        traceIds: 4,
        skippedOrphans: 1,
        orphanProjectIds: ["bb"],
        afterProjectId: "e",
      });
      expect(logger.warn).toHaveBeenCalledWith({ projectId: "bb" }, expect.any(String));
    });

    /** @scenario "The upgrade skips a project no organisation owns" */
    it("does not count the orphan twice when resumed from the checkpoint that counted it", async () => {
      const { run, saved } = compose({ orphans: ["bb"] });
      await run();
      const countedOrphan = saved.find(
        (report) => report.afterProjectId === "b" && report.skippedOrphans === 1,
      );

      const report = await run({ resumeFrom: countedOrphan ?? null });

      expect(countedOrphan).toBeDefined();
      expect(report).toMatchObject({ skippedOrphans: 1, orphanProjectIds: ["bb"] });
    });

    /** @scenario "The upgrade skips a project no organisation owns" */
    it("does not recount orphans beyond the named list when resumed", async () => {
      const orphans = Array.from({ length: 25 }, (_, i) => `b${String(i).padStart(2, "0")}`);
      const { run, saved } = compose({ orphans, pageSize: 100 });
      await run();
      const counted = saved.find((report) => report.skippedOrphans === 25);

      const report = await run({ resumeFrom: counted ?? null });

      expect(counted?.orphanProjectIds).toHaveLength(ORPHAN_IDS_REPORTED);
      expect(report.skippedOrphans).toBe(25);
    });

    /** @scenario "The upgrade skips a project no organisation owns" */
    it("reads an old checkpoint without the orphan fields as none skipped yet", () => {
      const { skippedOrphans: _count, orphanProjectIds: _ids, ...old } = REPORT_BASE;

      const parsed = traceMonthIdsReportSchema.parse({
        ...old,
        afterProjectId: "b",
        inProject: null,
        projects: 1,
        traceIds: 3,
        events: 2,
      });

      expect(parsed).toMatchObject({ skippedOrphans: 0, orphanProjectIds: [] });
    });

    /** @scenario "A dry run of the upgrade sends and saves nothing" */
    it("reports what it would send and records and saves nothing", async () => {
      const { run, recorded, saved } = compose();

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(saved).toEqual([]);
      expect(report).toMatchObject({ projects: 2, traceIds: 4, events: 3 });
    });

    /** @scenario "Re-running a finished upgrade sends nothing new" */
    it("sends nothing when resumed from a checkpoint after the last project", async () => {
      const { run, recorded } = compose();
      const finished = await run();
      recorded.length = 0;

      await run({ resumeFrom: finished });

      expect(recorded).toEqual([]);
    });

    it("stops before sending when aborted", async () => {
      const { run, recorded } = compose();
      const aborted = new AbortController();
      aborted.abort();

      await run({ signal: aborted.signal });

      expect(recorded).toEqual([]);
    });
  });
});
