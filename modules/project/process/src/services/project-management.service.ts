import {
  isAggregateProjectKind,
  isGovernanceProject,
  ProjectNotFoundError,
  type ArchivedProject,
  type Project,
  type ProjectWithTeam,
  type UpdateProjectInput,
} from "@langwatch/project-contract";

import type { AggregateAccessService } from "./aggregate-access.service.ts";
import type { ProjectService } from "./project.service.ts";

type ManagedProjects = Pick<ProjectService, "findWithTeam" | "update" | "archive">;

/**
 * `/api/projects/:id` for the credential's owner (`userId`, null for a key that
 * acts for nobody). What no listing shows this caller reads as absent: the
 * governance project, and an aggregate to anyone but an organisation admin (ADR-175).
 */
export class ProjectManagementService {
  readonly #projects: ManagedProjects;
  readonly #aggregateAccess: Pick<AggregateAccessService, "mayOpen">;

  private constructor({
    projects,
    aggregateAccess,
  }: {
    projects: ManagedProjects;
    aggregateAccess: Pick<AggregateAccessService, "mayOpen">;
  }) {
    this.#projects = projects;
    this.#aggregateAccess = aggregateAccess;
  }

  static create(dependencies: {
    projects: ManagedProjects;
    aggregateAccess: Pick<AggregateAccessService, "mayOpen">;
  }): ProjectManagementService {
    return new ProjectManagementService(dependencies);
  }

  async getInOrganization({
    projectId,
    organizationId,
    userId,
  }: {
    projectId: string;
    organizationId: string;
    userId: string | null;
  }): Promise<ProjectWithTeam> {
    const project = await this.#projects.findWithTeam(projectId);
    if (
      !project ||
      project.team.organizationId !== organizationId ||
      isGovernanceProject(project.kind)
    ) {
      throw new ProjectNotFoundError("Project not found");
    }
    await this.#refuseHiddenAggregate({ project, userId });
    return project;
  }

  async updateInOrganization(input: {
    id: string;
    organizationId: string;
    userId: string | null;
    data: UpdateProjectInput;
  }): Promise<Project> {
    await this.#refuseHiddenAggregateById(input);
    return this.#projects.update({
      id: input.id,
      organizationId: input.organizationId,
      data: input.data,
    });
  }

  async archiveInOrganization(input: {
    id: string;
    organizationId: string;
    userId: string | null;
  }): Promise<ArchivedProject> {
    await this.#refuseHiddenAggregateById(input);
    return this.#projects.archive({ id: input.id, organizationId: input.organizationId });
  }

  /** Every other refusal stays the write's own, so a missing or foreign id answers as before. */
  async #refuseHiddenAggregateById({
    id,
    organizationId,
    userId,
  }: {
    id: string;
    organizationId: string;
    userId: string | null;
  }): Promise<void> {
    const project = await this.#projects.findWithTeam(id);
    if (project?.team.organizationId !== organizationId) return;
    await this.#refuseHiddenAggregate({ project, userId });
  }

  async #refuseHiddenAggregate({
    project,
    userId,
  }: {
    project: ProjectWithTeam;
    userId: string | null;
  }): Promise<void> {
    if (!isAggregateProjectKind(project.kind)) return;
    const organizationId = project.team.organizationId;
    if (await this.#aggregateAccess.mayOpen({ organizationId, userId })) return;
    throw new ProjectNotFoundError("Project not found");
  }
}
