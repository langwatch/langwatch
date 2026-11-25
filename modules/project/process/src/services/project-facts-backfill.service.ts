/**
 * The project facts step: one pass over the projects table, a page at a time in id order, each
 * page's created facts, then department assignments, then presence settings sent as one batch
 * each. Spec: modules/project/specs/project-service.feature
 */
import type { ProjectRepository } from "../repositories/project.repository.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";
import { ProjectTablePagingService } from "./project-table-paging.service.ts";

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
  readonly #table: ProjectTablePagingService;

  private constructor(private readonly deps: Dependencies) {
    this.#table = ProjectTablePagingService.create(deps);
  }

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
    await this.#table.walk({
      stepName: "the project facts step",
      afterProjectId,
      orphans: report,
      signal,
      onPage: async ({ projects, orphans, afterProjectId: cursor, occurredAt }) => {
        const live = projects.filter((project) => !project.isArchived);
        if (!dryRun && projects.length > 0) {
          await this.deps.lifecycle.recordBackfillPage({ created: projects, live, occurredAt });
        }
        report.projects += projects.length;
        report.departmentAssignments += live.length;
        report.presenceSettings += live.length;
        report.skippedOrphans = orphans.skippedOrphans;
        report.orphanProjectIds = orphans.orphanProjectIds;
        if (!dryRun) await onPageDone({ afterProjectId: cursor, report: { ...report } });
      },
    });
    return report;
  }
}
