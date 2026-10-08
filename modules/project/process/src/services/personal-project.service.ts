import type { PersonalFeatures } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { ProjectRepository } from "../repositories/project.repository.ts";

/**
 * Project's side of organization's personal-workspace facts (§9, ruling C, 2026-10-08): the
 * personal project follows its personal team. Each reaction is idempotent, so a redelivery is safe.
 */
export class PersonalProjectService {
  static create(deps: { projects: ProjectRepository }): PersonalProjectService {
    return new PersonalProjectService(deps);
  }

  private constructor(private readonly deps: { projects: ProjectRepository }) {}

  archive({ teamIds, occurredAt }: { teamIds: string[]; occurredAt: number }): Promise<void> {
    return this.deps.projects.archivePersonalInTeams({
      teamIds,
      archivedAt: Temporal.Instant.fromEpochMilliseconds(occurredAt),
    });
  }

  revive({ teamId }: { teamId: string }): Promise<void> {
    return this.deps.projects.revivePersonalInTeam({ teamId });
  }

  setFeatures({
    projectId,
    features,
  }: {
    projectId: string;
    features: PersonalFeatures;
  }): Promise<void> {
    return this.deps.projects.updatePersonalFeatures({ projectId, features });
  }
}
