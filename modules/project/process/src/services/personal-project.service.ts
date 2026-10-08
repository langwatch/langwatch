import { randomBytes } from "node:crypto";

import type {
  PersonalFeatures,
  PersonalTeamCreatedEventData,
} from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { ProjectRepository } from "../repositories/project.repository.ts";

/** The personal project's ingestion key length, in the `pkey_` format organization minted. */
const PERSONAL_PROJECT_API_KEY_CHARS = 40;

function personalProjectApiKey(): string {
  const random = randomBytes(Math.ceil((PERSONAL_PROJECT_API_KEY_CHARS * 3) / 4)).toString(
    "base64url",
  );
  return `pkey_${random.slice(0, PERSONAL_PROJECT_API_KEY_CHARS)}`;
}

/**
 * Project's side of organization's personal-workspace facts (§9, ruling C, 2026-10-08): the
 * personal project follows its personal team. Each reaction is idempotent, so a redelivery is safe.
 */
export class PersonalProjectService {
  static create(deps: { projects: ProjectRepository }): PersonalProjectService {
    return new PersonalProjectService(deps);
  }

  private constructor(private readonly deps: { projects: ProjectRepository }) {}

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
      // Minted here, never carried by the fact, so no key enters the event log.
      apiKey: personalProjectApiKey(),
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
