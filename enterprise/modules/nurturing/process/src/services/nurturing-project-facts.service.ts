// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingPersonalProjectRepository,
  NurturingPersonalProjectRow,
} from "../repositories/nurturing-personal-project.repository.ts";
import type { NurturingTracedProjectRepository } from "../repositories/nurturing-traced-project.repository.ts";

type ProjectFactsDependencies = Readonly<{
  personalProjects: NurturingPersonalProjectRepository;
  tracedProjects: NurturingTracedProjectRepository;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
}>;

/**
 * Nurturing's copies of the owners' project facts: a personal project's owner and a project that
 * traced. It writes rows only; it holds no sink, so no Customer.io or PostHog request starts here.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
export class NurturingProjectFactsService {
  static create(dependencies: ProjectFactsDependencies): NurturingProjectFactsService {
    return new NurturingProjectFactsService(dependencies);
  }

  private constructor(private readonly dependencies: ProjectFactsDependencies) {}

  /** The first owner named for the project stays; a redelivery or a listing changes nothing. */
  recordPersonalOwner(input: NurturingPersonalProjectRow): Promise<void> {
    return this.dependencies.personalProjects.recordOwner(input);
  }

  /** A project with no organization has nothing to count against, so it is logged, not stored. */
  async recordTracedProject({
    projectId,
    organizationId,
  }: Readonly<{ projectId: string; organizationId: string | null }>): Promise<void> {
    if (organizationId === null) {
      this.dependencies.logger.warn(
        { projectId },
        "a traced project names no organization; nurturing keeps no traced row for it",
      );
      return;
    }
    await this.dependencies.tracedProjects.recordTraced({ projectId, organizationId });
  }
}
