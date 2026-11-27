/**
 * The walk both project data steps share: the projects table a page at a time in id order,
 * archived ones included, orphans counted and warned about. Each step supplies only its page work.
 * Spec: modules/project/specs/project-service.feature, project-history-listing.feature
 */
import { nowInstant } from "@langwatch/time";

import type { ProjectBackfillRow, ProjectRepository } from "../repositories/project.repository.ts";

const PAGE_SIZE = 2000;

/** How many skipped project ids a report names; the count covers the rest. */
const ORPHAN_IDS_REPORTED = 20;

/** Projects whose team or organization is gone, so a step sends nothing for them. */
export type ProjectOrphanTally = Readonly<{
  skippedOrphans: number;
  orphanProjectIds: string[];
}>;

export type ProjectTablePage = Readonly<{
  /** The page's projects that still have their team and organization, in id order. */
  projects: readonly ProjectBackfillRow[];
  /** Orphans through this page, so a checkpoint saved now counts each once. */
  orphans: ProjectOrphanTally;
  /** The page's last project id, where a resumed run starts. */
  afterProjectId: string;
  /** Taken before the read, so a change saved meanwhile is the newer fact. */
  occurredAt: number;
}>;

export type ProjectTableWalk = Readonly<{
  /** Names the step in the warning for each skipped project. */
  stepName: string;
  /** Where to start; null for the beginning of the table. */
  afterProjectId: string | null;
  /** The orphans a resumed run had already counted. */
  orphans: ProjectOrphanTally;
  signal: AbortSignal;
  /** Throws to stop the walk, so the step retries the page. */
  onPage: (page: ProjectTablePage) => Promise<void>;
}>;

type Dependencies = Readonly<{
  projects: Pick<ProjectRepository, "findBackfillPage">;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
}>;

/** Pages the projects table for a data step; the step decides what each page sends and saves. */
export class ProjectTablePagingService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): ProjectTablePagingService {
    return new ProjectTablePagingService(deps);
  }

  /** Walks the table from `afterProjectId` until the end or the signal aborts. */
  async walk({
    stepName,
    afterProjectId,
    orphans,
    signal,
    onPage,
  }: ProjectTableWalk): Promise<void> {
    let cursor = afterProjectId;
    let tally = orphans;
    while (!signal.aborted) {
      const occurredAt = nowInstant().epochMilliseconds;
      const page = await this.deps.projects.findBackfillPage({ afterId: cursor, limit: PAGE_SIZE });
      const last = page.at(-1);
      if (!last) break;
      const whole = page.flatMap((entry) => (entry.kind === "whole" ? [entry.project] : []));
      const orphanIds = page.flatMap((entry) => (entry.kind === "orphan" ? [entry.id] : []));
      tally = {
        skippedOrphans: tally.skippedOrphans + orphanIds.length,
        orphanProjectIds: [...tally.orphanProjectIds, ...orphanIds].slice(0, ORPHAN_IDS_REPORTED),
      };
      cursor = last.kind === "whole" ? last.project.id : last.id;
      await onPage({ projects: whole, orphans: tally, afterProjectId: cursor, occurredAt });
      for (const projectId of orphanIds) {
        this.deps.logger.warn(
          { projectId },
          `${stepName} skipped a project whose team or organization no longer exists`,
        );
      }
    }
  }
}
