/**
 * The project facts step: one pass over the projects table, a page at a time in id order, each
 * page's created facts, then department assignments, then presence settings sent as one batch
 * each. Spec: modules/project/specs/project-service.feature
 */
import { nowInstant } from "@langwatch/time";

import type {
  ProjectBackfillEntry,
  ProjectBackfillRow,
  ProjectRepository,
} from "../repositories/project.repository.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";

const PAGE_SIZE = 2000;

/** How many skipped project ids the report names; the count covers the rest. */
const ORPHAN_IDS_REPORTED = 20;

export type ProjectFactsBackfillReport = {
  projects: number;
  departmentAssignments: number;
  presenceSettings: number;
  /** Projects whose team or organization is gone, so the step records nothing for them. */
  skippedOrphans: number;
  orphanProjectIds: string[];
};

export type ProjectFactsBackfillRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  afterProjectId: string | null;
  /** What the run this one resumes had counted, so the report totals every attempt. */
  countedBefore: ProjectFactsBackfillReport;
  onPageDone: (input: {
    afterProjectId: string;
    report: ProjectFactsBackfillReport;
  }) => Promise<void>;
}>;

type Dependencies = Readonly<{
  projects: Pick<ProjectRepository, "findBackfillPage">;
  lifecycle: Pick<ProjectCreatedNoticeService, "recordBackfillPage">;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
}>;

/**
 * Every project is recorded as created, archived ones included; a live project also has its
 * department and presence setting recorded. Keyed per project, so a rerun adds nothing new.
 * A project left without a team or organization is skipped and counted, never retried.
 */
export class ProjectFactsBackfillService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): ProjectFactsBackfillService {
    return new ProjectFactsBackfillService(deps);
  }

  async recordExisting({
    dryRun,
    signal,
    afterProjectId,
    countedBefore,
    onPageDone,
  }: ProjectFactsBackfillRun): Promise<ProjectFactsBackfillReport> {
    const report: ProjectFactsBackfillReport = {
      ...countedBefore,
      orphanProjectIds: [...countedBefore.orphanProjectIds],
    };
    let cursor = afterProjectId;
    while (!signal.aborted) {
      // Taken before the read, so a change saved meanwhile is the newer fact.
      const occurredAt = nowInstant().epochMilliseconds;
      const page = await this.deps.projects.findBackfillPage({ afterId: cursor, limit: PAGE_SIZE });
      const last = page.at(-1);
      if (!last) break;
      const { projects, orphanIds } = splitEntries(page);
      const live: ProjectBackfillRow[] = projects.filter((project) => !project.isArchived);
      if (!dryRun && projects.length > 0) {
        await this.deps.lifecycle.recordBackfillPage({ created: projects, live, occurredAt });
      }
      this.warnSkipped(orphanIds);
      report.projects += projects.length;
      report.departmentAssignments += live.length;
      report.presenceSettings += live.length;
      report.skippedOrphans += orphanIds.length;
      report.orphanProjectIds = [...report.orphanProjectIds, ...orphanIds].slice(
        0,
        ORPHAN_IDS_REPORTED,
      );
      cursor = last.kind === "whole" ? last.project.id : last.id;
      if (!dryRun) await onPageDone({ afterProjectId: cursor, report: { ...report } });
    }
    return report;
  }

  private warnSkipped(orphanIds: readonly string[]): void {
    for (const projectId of orphanIds) {
      this.deps.logger.warn(
        { projectId },
        "the project facts step skipped a project whose team or organization no longer exists",
      );
    }
  }
}

/** A page's whole projects and the ids of its orphans, each in id order. */
function splitEntries(page: readonly ProjectBackfillEntry[]): {
  projects: ProjectBackfillRow[];
  orphanIds: string[];
} {
  const projects: ProjectBackfillRow[] = [];
  const orphanIds: string[] = [];
  for (const entry of page) {
    if (entry.kind === "whole") projects.push(entry.project);
    else orphanIds.push(entry.id);
  }
  return { projects, orphanIds };
}
