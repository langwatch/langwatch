import {
  internalProjectQuerySchema,
  PROJECT_KIND,
  type InternalProject,
  type InternalProjectQuery,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type { ProjectCredentialsPort } from "../ports/project.port";
import type { ProjectRepository } from "../repositories/project.repository";

/**
 * The one team read the internal-project mint makes.
 *
 * Narrowed off `OrganizationService`, which is a whole capability — members,
 * invites, billing tier, deletion — where this path asks a single question:
 * which team has been in this organization longest. `OrganizationService`
 * satisfies it structurally, so the application's own composition is
 * unchanged.
 */
export abstract class ProjectOldestTeamPort {
  abstract getOldestTeamId(input: { organizationId: string }): Promise<string>;
}

/**
 * The two project reads Governance's ingestion pull makes.
 *
 * `ProjectService` satisfies it, and so does the service below. Naming the
 * pair is what lets a background process pull a customer's usage without
 * composing a capability that additionally wants an LWQL key map, a
 * stored-object runtime and a diagnostics sink.
 */
export abstract class GovernanceInternalProjectPort {
  abstract tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;

  abstract ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
}

/**
 * The internal governance project, minted the way the capability mints it.
 *
 * BYTE-FOR-BYTE THE SAME SEQUENCE as `ProjectService.ensureInternal`, and it
 * has to be: the slug is derived (`governance-<organizationId>`) and the mint
 * races — two processes pulling the same organization's usage at once both
 * reach this, and the repository's create-or-find-winner is what makes one of
 * them lose gracefully. A second mint that spelled the slug differently would
 * give one organization two internal projects and split its pulled usage
 * across both.
 */
export class GovernanceInternalProjectService extends GovernanceInternalProjectPort {
  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentialsPort;
    teams: ProjectOldestTeamPort;
  }): GovernanceInternalProjectService {
    return new GovernanceInternalProjectService(
      options.repository,
      options.credentials,
      options.teams,
    );
  }

  private constructor(
    private readonly repository: ProjectRepository,
    private readonly credentials: ProjectCredentialsPort,
    private readonly teams: ProjectOldestTeamPort,
  ) {
    super();
  }

  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repository.tryGetWithTeam(id);
  }

  async ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    const parsed = internalProjectQuerySchema.parse(input);
    const existing = await this.repository.tryFindInternalByOrganization(parsed.organizationId);
    if (existing) {
      return existing;
    }

    const teamId = await this.teams.getOldestTeamId({ organizationId: parsed.organizationId });
    const slug = `governance-${parsed.organizationId}`;
    const bySlug = await this.repository.tryFindInternalBySlug(slug);
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
