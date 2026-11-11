/**
 * @vitest-environment node
 * Spec: modules/project/specs/project-history-listing.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type {
  RecordProjectFirstMessageListedCommandData,
  RecordProjectPersonalOwnerListedCommandData,
} from "../../eventing/project-lifecycle.events.ts";
import type {
  ProjectHistoryEntry,
  ProjectHistoryRow,
} from "../../repositories/project.repository.ts";
import {
  ProjectHistoryListingService,
  type ProjectHistoryListingCheckpoint,
  type ProjectHistoryListingReport,
} from "../project-history-listing.service.ts";

function row(input: Partial<ProjectHistoryRow> & { id: string }): ProjectHistoryRow {
  return {
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
    firstMessage: false,
    ...input,
  };
}

/**
 * P1 personal, P2 personal and archived (the page names no archive: archived rows are listed
 * alike), P3 personal with no owner, F1 and F2 flagged and shared, S1 shared and unflagged.
 */
const PROJECTS: readonly ProjectHistoryRow[] = [
  row({ id: "f1", firstMessage: true }),
  row({ id: "f2", organizationId: "org-2", firstMessage: true }),
  row({ id: "p1", isPersonal: true, ownerUserId: "user-1" }),
  row({ id: "p2", isPersonal: true, ownerUserId: "user-2", firstMessage: true }),
  row({ id: "p3", isPersonal: true }),
  row({ id: "s1" }),
];

const NOTHING_COUNTED: ProjectHistoryListingReport = {
  ownerFactsToSend: 0,
  firstMessageFactsToSend: 0,
  skippedOrphans: 0,
  orphanProjectIds: [],
};

type Sent =
  | { kind: "owner"; data: RecordProjectPersonalOwnerListedCommandData[] }
  | { kind: "firstMessage"; data: RecordProjectFirstMessageListedCommandData[] };

/** The step over a projects table served three rows a page, recording each batch it sends. */
function listingOver(
  projects: readonly ProjectHistoryRow[] = PROJECTS,
  orphanIds: readonly string[] = [],
  /** Throws instead of saving the nth page's checkpoint, as a worker dying after the send does. */
  crashBeforeSavingPage?: number,
) {
  const batches: Sent[] = [];
  const saves: ProjectHistoryListingCheckpoint[] = [];
  const { logger, lines } = createTestLogger();
  const service = ProjectHistoryListingService.create({
    projects: {
      findHistoryPage: async ({ afterId }) => {
        const ids = [...projects.map((project) => project.id), ...orphanIds].toSorted();
        const page = ids.filter((id) => afterId === null || id > afterId).slice(0, 3);
        return page.map((id): ProjectHistoryEntry => {
          const project = projects.find((candidate) => candidate.id === id);
          return project ? { kind: "whole", project } : { kind: "orphan", id };
        });
      },
    },
    logger,
  });
  service.connect({
    recordPersonalOwnerListed: {
      sendBatch: async (data) => void batches.push({ kind: "owner", data: [...data] }),
    },
    recordFirstMessageListed: {
      sendBatch: async (data) => void batches.push({ kind: "firstMessage", data: [...data] }),
    },
  });
  let pagesDone = 0;
  const run = ({
    resumeFrom = null,
    dryRun = false,
    signal = new AbortController().signal,
  }: {
    resumeFrom?: unknown;
    dryRun?: boolean;
    signal?: AbortSignal;
  } = {}) =>
    service.sendHistory({
      dryRun,
      signal,
      resumeFrom,
      onPageDone: async (checkpoint) => {
        pagesDone += 1;
        if (pagesDone === crashBeforeSavingPage) throw new Error("worker stopped before saving");
        saves.push(checkpoint);
      },
    });
  return { batches, saves, run, warnings: lines };
}

const named = (batches: readonly Sent[], kind: Sent["kind"]) =>
  batches.filter((sent) => sent.kind === kind).flatMap((sent) => sent.data);

describe("given the project history listing over personal, flagged and shared projects", () => {
  describe("when it runs", () => {
    /** @scenario "The project history listing sends each personal project's owner" */
    it("sends one owner fact per personal project with an owner, and none for the rest", async () => {
      const { batches, run } = listingOver();

      await run();

      expect(named(batches, "owner").map(({ occurredAt: _at, ...fact }) => fact)).toEqual([
        { tenantId: "p1", projectId: "p1", organizationId: "org-1", ownerUserId: "user-1" },
        { tenantId: "p2", projectId: "p2", organizationId: "org-1", ownerUserId: "user-2" },
      ]);
    });

    /** @scenario "The project history listing sends each project that received its first message" */
    it("sends one first-message fact per flagged project, personal or shared, and none for the rest", async () => {
      const { batches, run } = listingOver();

      await run();

      expect(named(batches, "firstMessage").map(({ occurredAt: _at, ...fact }) => fact)).toEqual([
        { tenantId: "f1", projectId: "f1", organizationId: "org-1" },
        { tenantId: "f2", projectId: "f2", organizationId: "org-2" },
        { tenantId: "p2", projectId: "p2", organizationId: "org-1" },
      ]);
    });

    /** @scenario "The project history listing saves its progress after every page" */
    it("sends each page as one batch per kind and saves after each page", async () => {
      const { batches, saves, run } = listingOver();

      const report = await run();

      expect(batches.map((sent) => [sent.kind, sent.data.map((fact) => fact.projectId)])).toEqual([
        ["owner", ["p1"]],
        ["firstMessage", ["f1", "f2"]],
        ["owner", ["p2"]],
        ["firstMessage", ["p2"]],
      ]);
      expect(saves).toEqual([
        {
          afterProjectId: "p1",
          ...NOTHING_COUNTED,
          ownerFactsToSend: 1,
          firstMessageFactsToSend: 2,
        },
        {
          afterProjectId: "s1",
          ...NOTHING_COUNTED,
          ownerFactsToSend: 2,
          firstMessageFactsToSend: 3,
        },
      ]);
      expect(report).toEqual({
        ...NOTHING_COUNTED,
        ownerFactsToSend: 2,
        firstMessageFactsToSend: 3,
      });
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the project history listing counts what it would send and sends nothing" */
    it("reports the same counts a real run sends, and sends and saves nothing", async () => {
      const dry = listingOver();
      const real = listingOver();

      const dryReport = await dry.run({ dryRun: true });
      const realReport = await real.run();

      expect(dry.batches).toEqual([]);
      expect(dry.saves).toEqual([]);
      expect(dryReport).toEqual(realReport);
      expect(dryReport.ownerFactsToSend).toBe(named(real.batches, "owner").length);
      expect(dryReport.firstMessageFactsToSend).toBe(named(real.batches, "firstMessage").length);
    });

    /** @scenario "A dry run of the project history listing ignores a saved checkpoint" */
    it("counts the whole table even when an interrupted run saved a checkpoint", async () => {
      const interrupted = listingOver();
      await interrupted.run();
      const dry = listingOver();

      const dryReport = await dry.run({ dryRun: true, resumeFrom: interrupted.saves[0] });

      expect(dryReport).toEqual({
        ...NOTHING_COUNTED,
        ownerFactsToSend: 2,
        firstMessageFactsToSend: 3,
      });
      expect(dry.batches).toEqual([]);
    });
  });

  describe("when a project's team or organization is gone", () => {
    /** @scenario "The project history listing skips a project whose team or organization is gone" */
    it("sends nothing for it, counts and names it, and moves past it", async () => {
      const { batches, saves, run, warnings } = listingOver(PROJECTS, ["o1"]);

      const report = await run();

      expect(batches.flatMap((sent) => sent.data.map((fact) => fact.projectId))).not.toContain(
        "o1",
      );
      expect(report).toMatchObject({ skippedOrphans: 1, orphanProjectIds: ["o1"] });
      expect(saves.at(-1)).toMatchObject({ afterProjectId: "s1" });
      expect(warnings.map((line) => [line.level, line.projectId])).toEqual([[40, "o1"]]);
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The project history listing resumes after the last page it saved" */
    it("sends only the projects after the saved one and adds to the saved counts", async () => {
      const { batches, run } = listingOver();

      const report = await run({
        resumeFrom: {
          afterProjectId: "p1",
          ...NOTHING_COUNTED,
          ownerFactsToSend: 1,
          firstMessageFactsToSend: 2,
        },
      });

      expect(batches.flatMap((sent) => sent.data.map((fact) => fact.projectId))).toEqual([
        "p2",
        "p2",
      ]);
      expect(report).toMatchObject({ ownerFactsToSend: 2, firstMessageFactsToSend: 3 });
    });
  });

  describe("when the worker dies after a page's send and before its checkpoint", () => {
    /** @scenario "A run that dies between a page's send and its checkpoint counts that page once" */
    it("resends the page on resume and reports the same counts as a clean run", async () => {
      const clean = listingOver(PROJECTS, ["o1"]);
      const crashed = listingOver(PROJECTS, ["o1"], 2);

      const cleanReport = await clean.run();
      await expect(crashed.run()).rejects.toThrow("worker stopped before saving");
      const resumedReport = await crashed.run({ resumeFrom: crashed.saves.at(-1) });

      expect(resumedReport).toEqual(cleanReport);
      expect(crashed.saves.at(-1)).toEqual({ afterProjectId: "s1", ...cleanReport });
      // The dead page is sent twice; each fact's key collapses the second send.
      expect(named(crashed.batches, "owner").map((fact) => fact.projectId)).toEqual([
        "p1",
        "p2",
        "p1",
        "p2",
      ]);
    });
  });

  describe("when it runs twice", () => {
    /** @scenario "Re-running the project history listing sends the same facts again" */
    it("sends the same facts for the same projects, which their keys collapse", async () => {
      const first = listingOver();
      const second = listingOver();

      await first.run();
      await second.run();

      const projectIds = (sent: readonly Sent[]) =>
        sent.map((batch) => [batch.kind, batch.data.map((fact) => fact.projectId)]);
      expect(projectIds(second.batches)).toEqual(projectIds(first.batches));
    });
  });

  describe("when the worker stops it", () => {
    /** @scenario "The project history listing stops between pages when the worker stops it" */
    it("sends and saves nothing", async () => {
      const { batches, saves, run } = listingOver();
      const stopped = new AbortController();
      stopped.abort();

      await run({ signal: stopped.signal });

      expect(batches).toEqual([]);
      expect(saves).toEqual([]);
    });
  });
});
