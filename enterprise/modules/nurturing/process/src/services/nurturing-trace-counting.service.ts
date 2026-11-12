// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";
import type { NurturingTraceDayRepository } from "../repositories/nurturing-trace-day.repository.ts";
import { isTraceCounted } from "../rules/nurturing-project-usage.rules.ts";
import type { NurturingCountedTrace } from "../rules/nurturing-trace-day.rules.ts";
import { copiedProjectOf } from "./nurturing-copied-project.ts";
import type { NurturingUncopiedProjectsService } from "./nurturing-uncopied-projects.service.ts";

type TraceCountingDependencies = Readonly<{
  traceDays: NurturingTraceDayRepository;
  placements: Pick<NurturingProjectPlacementRepository, "getPlacement">;
  organizationsCreated: Pick<NurturingOrganizationCreatedRepository, "findOrganizationCreatedAt">;
  uncopiedProjects: Pick<NurturingUncopiedProjectsService, "isDropped" | "outcomeOf">;
}>;

/**
 * Counts the batch's traces whose organization is inside its counting window, durably. A
 * redelivered batch counts again: accepted (owner decision, issue 9378). The placement copy has
 * its own subscriber, so a new project's traces can come first: an uncopied project fails the
 * batch before anything is counted, so our own retry never counts a placed project twice, and the
 * queue retries until its window from first seen runs out; then it drops, as does a placed project
 * whose organization has no creation copy. A project this process dropped is skipped with no
 * read; its copy landing forgets it.
 */
export class NurturingTraceCountingService {
  static create(dependencies: TraceCountingDependencies): NurturingTraceCountingService {
    return new NurturingTraceCountingService(dependencies);
  }

  private constructor(private readonly dependencies: TraceCountingDependencies) {}

  async countTraces({
    traces,
  }: Readonly<{ traces: readonly NurturingCountedTrace[] }>): Promise<void> {
    if (traces.length === 0) return;
    const { traceDays, placements, organizationsCreated, uncopiedProjects } = this.dependencies;
    const projectIds = [...new Set(traces.map(({ projectId }) => projectId))].filter(
      (projectId) => !uncopiedProjects.isDropped({ projectId }),
    );
    const projects = new Map(
      await Promise.all(
        projectIds.map(
          async (projectId) =>
            [
              projectId,
              await copiedProjectOf({ projectId, placements, organizationsCreated }),
            ] as const,
        ),
      ),
    );
    const projectOf = (trace: NurturingCountedTrace) =>
      projects.get(trace.projectId) ?? { outcome: "unplaced" as const };
    const outcomes = await Promise.all(
      [...projects].map(async ([projectId, project]) =>
        project.outcome === "unplaced" &&
        (await uncopiedProjects.outcomeOf({ projectId })) === "retry"
          ? [projectId]
          : [],
      ),
    );
    const waiting = outcomes.flat();
    if (waiting.length > 0) {
      throw new Error(`nurturing's placement copy of ${waiting.join(", ")} has not landed yet`);
    }
    await traceDays.countTraces(
      traces.filter((trace) => {
        const project = projectOf(trace);
        return (
          project.outcome === "placed" &&
          isTraceCounted({ organizationCreatedAt: project.organizationCreatedAt, at: trace.at })
        );
      }),
    );
  }
}
