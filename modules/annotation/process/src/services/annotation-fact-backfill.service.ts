import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { AnnotationScoreRepository } from "../repositories/annotation-score.repository.ts";
import type { AnnotationRepository } from "../repositories/annotation.repository.ts";
import type { AnnotationFactsService } from "./annotation-facts.service.ts";

export type AnnotationFactBackfillReport = {
  projects: number;
  annotations: number;
  scores: number;
};

export type AnnotationFactBackfillRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  afterProjectId: string | null;
  onProjectDone: (input: {
    projectId: string;
    report: AnnotationFactBackfillReport;
  }) => Promise<void>;
}>;

type Dependencies = Readonly<{
  annotations: Pick<AnnotationRepository, "findAll">;
  scores: Pick<AnnotationScoreRepository, "findScoreNames">;
  facts: Pick<AnnotationFactsService, "annotationCreated" | "scoreDefined">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  organizations: Pick<OrganizationApi, "findAllIds">;
}>;

/**
 * Records every stored annotation and score definition as annotation's fact, project by project in
 * id order. Keyed on the stored write: a second run records nothing, a row changed since again.
 */
export class AnnotationFactBackfillService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): AnnotationFactBackfillService {
    return new AnnotationFactBackfillService(deps);
  }

  async recordExisting({
    dryRun,
    signal,
    afterProjectId,
    onProjectDone,
  }: AnnotationFactBackfillRun): Promise<AnnotationFactBackfillReport> {
    const report: AnnotationFactBackfillReport = { projects: 0, annotations: 0, scores: 0 };
    for (const projectId of await this.#projectIdsAfter(afterProjectId)) {
      if (signal.aborted) break;
      await this.#recordProject({ projectId, dryRun, report });
      report.projects += 1;
      if (!dryRun) await onProjectDone({ projectId, report: { ...report } });
    }
    return report;
  }

  async #projectIdsAfter(afterProjectId: string | null): Promise<string[]> {
    const projectIds = new Set<string>();
    for (const organizationId of await this.deps.organizations.findAllIds()) {
      for (const projectId of await this.deps.projects.listIdsByOrganization({ organizationId })) {
        projectIds.add(projectId);
      }
    }
    return [...projectIds]
      .filter((projectId) => afterProjectId === null || projectId > afterProjectId)
      .toSorted();
  }

  async #recordProject({
    projectId,
    dryRun,
    report,
  }: {
    projectId: string;
    dryRun: boolean;
    report: AnnotationFactBackfillReport;
  }): Promise<void> {
    const scores = await this.deps.scores.findScoreNames({ projectId });
    for (const score of scores) {
      if (!dryRun) {
        await this.deps.facts.scoreDefined({
          scoreId: score.id,
          projectId,
          name: score.name,
          backfilled: true,
        });
      }
      report.scores += 1;
    }
    const annotations = await this.deps.annotations.findAll({ projectId, anchor: "all" });
    for (const annotation of annotations) {
      if (!dryRun) await this.deps.facts.annotationCreated({ annotation, backfilled: true });
      report.annotations += 1;
    }
  }
}
