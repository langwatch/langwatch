/**
 * @vitest-environment node
 * Spec: modules/project/specs/project-service.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { ProjectBackfillRow } from "../../repositories/project.repository.ts";
import { ProjectCreatedNoticeService } from "../project-created-notice.service.ts";
import {
  ProjectFactsBackfillService,
  type ProjectFactsBackfillReport,
} from "../project-facts-backfill.service.ts";

function row(input: Partial<ProjectBackfillRow> & { id: string }): ProjectBackfillRow {
  return {
    createdAt: fromDate(new Date(`2025-0${input.id.at(-1) ?? "1"}-01T00:00:00.000Z`)),
    organizationId: "org-1",
    teamId: "team-1",
    isPersonal: false,
    departmentId: null,
    presenceEnabled: true,
    isArchived: false,
    adminUserId: "admin-1",
    ...input,
  };
}

const PROJECTS: readonly ProjectBackfillRow[] = [
  row({ id: "project-1", departmentId: "dep-eng" }),
  row({ id: "project-2", presenceEnabled: false }),
  row({ id: "project-3", isArchived: true }),
];

const NOTHING_COUNTED: ProjectFactsBackfillReport = {
  projects: 0,
  departmentAssignments: 0,
  presenceSettings: 0,
  skippedOrphans: 0,
  orphanProjectIds: [],
};

const NO_ORPHANS: Pick<ProjectFactsBackfillReport, "skippedOrphans" | "orphanProjectIds"> = {
  skippedOrphans: 0,
  orphanProjectIds: [],
};

type Sent = { kind: "created" | "department" | "presence"; data: Record<string, unknown>[] };

/** The step over a projects table served two rows a page, recording each batch it sends. */
function stepOver(
  projects: readonly ProjectBackfillRow[] = PROJECTS,
  orphanIds: readonly string[] = [],
) {
  const batches: Sent[] = [];
  const saves: unknown[] = [];
  const reads: (string | null)[] = [];
  const { logger, lines } = createTestLogger();
  const lifecycle = ProjectCreatedNoticeService.create({
    logger: { error: vi.fn() },
    projects: { findWithOrgAdmin: async () => null, findWithTeam: async () => null },
  });
  const quiet = { send: async () => undefined };
  const batching = (kind: Sent["kind"]) => ({
    send: async () => {
      throw new Error("the facts step sends a page as one batch, never one command at a time");
    },
    sendBatch: async (data: Record<string, unknown>[]) => void batches.push({ kind, data }),
  });
  lifecycle.connect({
    recordProjectCreated: batching("created"),
    recordProjectLegacyKeyRevoked: quiet,
    recordPresenceSettingChanged: batching("presence"),
    recordProjectMoved: quiet,
    recordProjectArchived: quiet,
    recordProjectDepartmentAssigned: batching("department"),
    recordProjectTraceSharingDisabled: quiet,
    recordProjectAggregateRuleChanged: quiet,
    recordProjectRevived: quiet,
  });
  const service = ProjectFactsBackfillService.create({
    projects: {
      listBackfillPage: async ({ afterId }) => {
        reads.push(afterId);
        const ids = [...projects.map((project) => project.id), ...orphanIds].toSorted();
        const page = ids.filter((id) => afterId === null || id > afterId).slice(0, 2);
        return {
          projects: projects.filter((project) => page.includes(project.id)),
          orphanIds: orphanIds.filter((id) => page.includes(id)),
          lastId: page.at(-1) ?? null,
        };
      },
    },
    lifecycle,
    logger,
  });
  const run = ({
    afterProjectId = null,
    countedBefore = NOTHING_COUNTED,
    dryRun = false,
    signal = new AbortController().signal,
  }: {
    afterProjectId?: string | null;
    countedBefore?: ProjectFactsBackfillReport;
    dryRun?: boolean;
    signal?: AbortSignal;
  } = {}) =>
    service.recordExisting({
      dryRun,
      signal,
      afterProjectId,
      countedBefore,
      onPageDone: async (page) => void saves.push(page),
    });
  return { batches, saves, reads, run, warnings: lines };
}

const withoutMoment = (data: Record<string, unknown>[]) =>
  data.map(({ occurredAt: _at, ...rest }) => rest);
const idsOf = (sent: Sent) => sent.data.map((data) => data.projectId);

describe("given the project facts step over three projects, two a page", () => {
  describe("when it runs", () => {
    /** @scenario "The project facts step walks the projects table once, a page at a time" */
    it("sends each page's facts as one batch per kind, in order, and saves after each page", async () => {
      const { batches, saves, reads, run } = stepOver();

      const report = await run();

      expect(reads).toEqual([null, "project-2", "project-3"]);
      expect(batches.map((sent) => [sent.kind, idsOf(sent)])).toEqual([
        ["created", ["project-1", "project-2"]],
        ["department", ["project-1", "project-2"]],
        ["presence", ["project-1", "project-2"]],
        ["created", ["project-3"]],
      ]);
      expect(saves).toEqual([
        {
          afterProjectId: "project-2",
          report: { projects: 2, departmentAssignments: 2, presenceSettings: 2, ...NO_ORPHANS },
        },
        {
          afterProjectId: "project-3",
          report: { projects: 3, departmentAssignments: 2, presenceSettings: 2, ...NO_ORPHANS },
        },
      ]);
      expect(report).toEqual({
        projects: 3,
        departmentAssignments: 2,
        presenceSettings: 2,
        ...NO_ORPHANS,
      });
    });

    /** @scenario "The project facts step records an archived project as created only" */
    it("records the archived project as created and nothing else", async () => {
      const { batches, run } = stepOver();

      await run();

      const named = (kind: Sent["kind"]) =>
        batches.filter((sent) => sent.kind === kind).flatMap(idsOf);
      expect(named("created")).toContain("project-3");
      expect(named("department")).not.toContain("project-3");
      expect(named("presence")).not.toContain("project-3");
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The project facts step resumes after the last page it saved" */
    it("records only the projects after the saved one and adds to the saved counts", async () => {
      const { batches, run } = stepOver();

      const report = await run({
        afterProjectId: "project-2",
        countedBefore: {
          projects: 2,
          departmentAssignments: 2,
          presenceSettings: 2,
          ...NO_ORPHANS,
        },
      });

      expect(batches.flatMap(idsOf)).toEqual(["project-3"]);
      expect(report).toEqual({
        projects: 3,
        departmentAssignments: 2,
        presenceSettings: 2,
        ...NO_ORPHANS,
      });
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the project facts step records nothing and saves no checkpoint" */
    it("sends nothing, saves nothing and counts what it would record", async () => {
      const { batches, saves, run } = stepOver();

      const report = await run({ dryRun: true });

      expect(batches).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toEqual({
        projects: 3,
        departmentAssignments: 2,
        presenceSettings: 2,
        ...NO_ORPHANS,
      });
    });
  });

  describe("when the worker has stopped it", () => {
    /** @scenario "The project facts step stops between pages when the worker stops it" */
    it("reads nothing, records nothing and saves no checkpoint", async () => {
      const { batches, saves, reads, run } = stepOver();
      const controller = new AbortController();
      controller.abort();

      await run({ signal: controller.signal });

      expect(reads).toEqual([]);
      expect(batches).toEqual([]);
      expect(saves).toEqual([]);
    });
  });
});

describe("given a live project between two whose team or organization is gone", () => {
  const orphans = ["project-0", "project-2"];
  const live = [row({ id: "project-1" })];

  describe("when it runs", () => {
    /** @scenario "The project facts step skips a project whose team or organization is gone" */
    it("records the live project only, counts and names both orphans, and saves past them", async () => {
      const { batches, saves, reads, run, warnings } = stepOver(live, orphans);

      const report = await run();

      expect(batches.map((sent) => [sent.kind, idsOf(sent)])).toEqual([
        ["created", ["project-1"]],
        ["department", ["project-1"]],
        ["presence", ["project-1"]],
      ]);
      expect(reads).toEqual([null, "project-1", "project-2"]);
      expect(saves.map((save) => (save as { afterProjectId: string }).afterProjectId)).toEqual([
        "project-1",
        "project-2",
      ]);
      expect(report).toEqual({
        projects: 1,
        departmentAssignments: 1,
        presenceSettings: 1,
        skippedOrphans: 2,
        orphanProjectIds: ["project-0", "project-2"],
      });
      expect(warnings.map((line) => [line.level, line.projectId])).toEqual([
        [40, "project-0"],
        [40, "project-2"],
      ]);
    });
  });

  describe("when a page holds only an orphan", () => {
    /** @scenario "The project facts step skips a project whose team or organization is gone" */
    it("sends nothing for that page and still moves the checkpoint past it", async () => {
      const { batches, saves, run } = stepOver([], ["project-9"]);

      const report = await run();

      expect(batches).toEqual([]);
      expect(saves).toEqual([
        {
          afterProjectId: "project-9",
          report: { ...NOTHING_COUNTED, skippedOrphans: 1, orphanProjectIds: ["project-9"] },
        },
      ]);
      expect(report.skippedOrphans).toBe(1);
    });
  });
});

describe("given two projects stored before project recorded their facts", () => {
  const two = [
    row({ id: "project-1", departmentId: "dep-eng" }),
    row({ id: "project-2", presenceEnabled: false, isPersonal: true }),
  ];
  const twice = async (kind: Sent["kind"]) => {
    const { batches, run } = stepOver(two);
    await run();
    const first = batches.filter((sent) => sent.kind === kind).flatMap((sent) => sent.data);
    batches.length = 0;
    await run();
    const second = batches.filter((sent) => sent.kind === kind).flatMap((sent) => sent.data);
    const moments = first.map((data) => data.occurredAt);
    return { first: withoutMoment(first), second: withoutMoment(second), moments };
  };

  describe("when the project:record-created-facts step runs twice", () => {
    /** @scenario "Existing projects are recorded as created by the backfill, idempotently" */
    it("records both as created, marked backfilled with the admin, alike on both runs", async () => {
      const { first, second, moments } = await twice("created");

      expect(moments).toEqual([
        Date.parse("2025-01-01T00:00:00.000Z"),
        Date.parse("2025-02-01T00:00:00.000Z"),
      ]);
      expect(first).toEqual(
        ["project-1", "project-2"].map((projectId) => ({
          tenantId: projectId,
          projectId,
          organizationId: "org-1",
          adminUserId: "admin-1",
          backfilled: true,
        })),
      );
      expect(second).toEqual(first);
    });

    /** @scenario "Existing projects' presence settings are recorded by the backfill, idempotently" */
    it("records each stored presence setting once per run, marked backfilled, with no changer", async () => {
      const { first, second } = await twice("presence");

      expect(first).toEqual([
        {
          tenantId: "project-1",
          projectId: "project-1",
          organizationId: "org-1",
          presenceEnabled: true,
          backfilled: true,
        },
        {
          tenantId: "project-2",
          projectId: "project-2",
          organizationId: "org-1",
          presenceEnabled: false,
          backfilled: true,
        },
      ]);
      expect(second).toEqual(first);
    });

    /** @scenario "Existing projects' departments and teams are recorded by the backfill, idempotently" */
    it("records each department, team and personal flag once per run, marked backfilled", async () => {
      const { first, second } = await twice("department");

      expect(first).toEqual([
        {
          tenantId: "project-1",
          projectId: "project-1",
          organizationId: "org-1",
          departmentId: "dep-eng",
          teamId: "team-1",
          isPersonal: false,
          backfilled: true,
        },
        {
          tenantId: "project-2",
          projectId: "project-2",
          organizationId: "org-1",
          departmentId: null,
          teamId: "team-1",
          isPersonal: true,
          backfilled: true,
        },
      ]);
      expect(second).toEqual(first);
    });
  });
});
