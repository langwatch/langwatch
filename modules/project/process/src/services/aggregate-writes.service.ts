import {
  assertProjectKindAcceptsWrites,
  projectKindAcceptsWrites,
} from "@langwatch/project-contract";

import type { ProjectRepository } from "../repositories/project.repository.ts";

/** ADR-175 decision 8: an aggregate is read only, so a write under its tenant is refused. */
export class AggregateWritesService {
  static create(deps: {
    projects: Pick<ProjectRepository, "findIdentity">;
  }): AggregateWritesService {
    return new AggregateWritesService(deps);
  }

  private constructor(
    private readonly deps: { projects: Pick<ProjectRepository, "findIdentity"> },
  ) {}

  /** False on an aggregate; a project this reader does not know may take writes. */
  async acceptsWrites({ projectId }: { projectId: string }): Promise<boolean> {
    const identity = await this.deps.projects.findIdentity(projectId);

    return projectKindAcceptsWrites(identity?.kind);
  }

  /** Refuses a write under an aggregate with the read-only answer, before anything is written. */
  async assertAcceptsWrites({ projectId }: { projectId: string }): Promise<void> {
    const identity = await this.deps.projects.findIdentity(projectId);

    assertProjectKindAcceptsWrites(identity?.kind);
  }
}
