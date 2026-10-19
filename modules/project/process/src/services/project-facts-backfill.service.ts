/**
 * The project facts step: one pass over the projects table, a page at a time in id order, each
 * page's created facts, then department assignments, then presence settings sent as one batch
 * each. Spec: modules/project/specs/project-service.feature
 */
import { nowInstant } from "@langwatch/time";

import type { ProjectBackfillRow, ProjectRepository } from "../repositories/project.repository.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";

const PAGE_SIZE = 2000;

export type ProjectFactsBackfillReport = {
  projects: number;
  departmentAssignments: number;
  presenceSettings: number;
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
}>;

/**
 * Every project is recorded as created, archived ones included; a live project also has its
 * department and presence setting recorded. Keyed per project, so a rerun adds nothing new.
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
    const report: ProjectFactsBackfillReport = { ...countedBefore };
    let cursor = afterProjectId;
    while (!signal.aborted) {
      // Taken before the read, so a change saved meanwhile is the newer fact.
      const occurredAt = nowInstant().epochMilliseconds;
      const page = await this.deps.projects.findBackfillPage({ afterId: cursor, limit: PAGE_SIZE });
      const last = page.at(-1);
      if (!last) break;
      const live: ProjectBackfillRow[] = page.filter((project) => !project.isArchived);
      if (!dryRun) {
        await this.deps.lifecycle.recordBackfillPage({ created: page, live, occurredAt });
      }
      report.projects += page.length;
      report.departmentAssignments += live.length;
      report.presenceSettings += live.length;
      cursor = last.id;
      if (!dryRun) await onPageDone({ afterProjectId: cursor, report: { ...report } });
    }
    return report;
  }
}
