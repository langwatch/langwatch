import {
  internalProjectQuerySchema,
  PROJECT_KIND,
  type InternalProject,
  type InternalProjectQuery,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type { ProjectCredentials } from "./project-credentials.service.ts";
import type { ProjectRepository } from "../repositories/project.repository.ts";

/**
 * Single question: which team has been in organization longest. Narrowed from
 * full OrganizationService to keep composition unchanged.
 */
export abstract class ProjectOldestTeam {
  abstract getOldestTeamId(input: { organizationId: string }): Promise<string>;
}

/**
 * The two project reads Governance's ingestion pull makes. `ProjectService`
 * satisfies it, and so does the service below — naming the pair lets a
 * background process pull usage without composing a heavier capability.
 */
export abstract class GovernanceInternalProject {
  abstract findWithTeam(id: string): Promise<ProjectWithTeam | null>;

  abstract ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
}

/**
 * Mints internal governance project with deterministic slug to prevent race-time
 * duplication; must match ProjectService.ensureInternal exactly.
 */
export class GovernanceInternalProjectService extends GovernanceInternalProject {
  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    teams: ProjectOldestTeam;
  }): GovernanceInternalProjectService {
    return new GovernanceInternalProjectService(
      options.repository,
      options.credentials,
      options.teams,
    );
  }

  private constructor(
    private readonly repository: ProjectRepository,
    private readonly credentials: ProjectCredentials,
    private readonly teams: ProjectOldestTeam,
  ) {
    super();
  }

  findWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repository.findWithTeam(id);
  }

  async ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    const parsed = internalProjectQuerySchema.parse(input);
    const existing = await this.repository.findInternalByOrganization(parsed.organizationId);
    if (existing) {
      return existing;
    }

    const teamId = await this.teams.getOldestTeamId({ organizationId: parsed.organizationId });
    const slug = `governance-${parsed.organizationId}`;
    const bySlug = await this.repository.findInternalBySlug(slug);
    if (bySlug?.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) {
      return bySlug;
    }

    return this.repository.createInternalOrFindWinner({
      id: this.credentials.generateProjectId(),
      name: "Governance (internal)",
      slug,
      apiKey: this.credentials.generateApiKey(),
      teamId,
    });
  }
}
