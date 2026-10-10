import type {
  PersonalFeatures,
  PersonalTeamCreatedEventData,
} from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";
import type { ProjectCredentials } from "./project-credentials.service.ts";

type PersonalProjectDependencies = Readonly<{
  projects: ProjectRepository;
  /** Fills the required key column with a value no door resolves (ADR-002). */
  credentials: Pick<ProjectCredentials, "generateApiKey">;
  lifecycle: Pick<ProjectCreatedNoticeService, "revived">;
}>;

/**
 * Project's side of organization's personal-workspace facts (§9, ruling C, 2026-10-08): the
 * personal project follows its personal team. Each reaction is idempotent, so a redelivery is safe.
 */
export class PersonalProjectService {
  static create(deps: PersonalProjectDependencies): PersonalProjectService {
    return new PersonalProjectService(deps);
  }

  private constructor(private readonly deps: PersonalProjectDependencies) {}

  /** Answers the team's personal project id: a redelivered fact's own id may have no row. */
  create({
    teamId,
    projectId,
    projectSlug,
    userId,
  }: Pick<
    PersonalTeamCreatedEventData,
    "teamId" | "projectId" | "projectSlug" | "userId"
  >): Promise<string> {
    return this.deps.projects.createPersonal({
      id: projectId,
      slug: projectSlug,
      apiKey: this.deps.credentials.generateApiKey(),
      teamId,
      ownerUserId: userId,
    });
  }

  archive({ teamIds, occurredAt }: { teamIds: string[]; occurredAt: number }): Promise<void> {
    return this.deps.projects.archivePersonalInTeams({
      teamIds,
      archivedAt: Temporal.Instant.fromEpochMilliseconds(occurredAt),
    });
  }

  /** Records each revived project; aggregates reading personal projects react (ADR-177). */
  async revive({
    teamId,
    organizationId,
  }: {
    teamId: string;
    organizationId: string;
  }): Promise<void> {
    const revived = await this.deps.projects.revivePersonalInTeam({ teamId });
    for (const projectId of revived) {
      await this.deps.lifecycle.revived({ projectId, organizationId });
    }
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
