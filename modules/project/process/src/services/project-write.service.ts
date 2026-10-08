import {
  type OrganizationApi,
  type OrganizationTeam,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import {
  AGGREGATE_DEFAULT_RULE,
  PROJECT_KIND,
  ProjectCreateTargetMissingError,
  createProjectInputSchema,
  isAggregateProjectKind,
  type AggregateRule,
  type CreatableProjectKind,
  type ArchivedProject,
  type Project,
  type UpdateProjectInput,
  DestinationTeamNotFoundError,
  assertNotGovernanceProject,
  assertPersonalProjectArchivable,
  assertPersonalWorkspaceCreate,
  assertPersonalWorkspaceMove,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
} from "@langwatch/project-contract";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import { mintProjectSlug, projectIdSlugToken } from "../rules/project-slug-service.rules.ts";
import type { AggregateRuleService } from "./aggregate-rule.service.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";
import type { ProjectCredentials } from "./project-credentials.service.ts";
import type { ProjectDiagnostics, ProjectStoredObjects } from "./project.service.ts";

/** Project create, update and archive, with the personal-workspace guards they apply. */
export class ProjectWriteService {
  private readonly repository: ProjectRepository;
  private readonly credentials: ProjectCredentials;
  private readonly organizations: OrganizationApi;
  private readonly created: ProjectCreatedNoticeService;
  private readonly storedObjects?: ProjectStoredObjects;
  private readonly diagnostics?: ProjectDiagnostics;
  /** ADR-175: validates an aggregate's rule; absent, creating one is refused. */
  private readonly aggregateRules?: AggregateRuleService;

  private constructor(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
    created: ProjectCreatedNoticeService;
    storedObjects?: ProjectStoredObjects;
    diagnostics?: ProjectDiagnostics;
    aggregateRules?: AggregateRuleService;
  }) {
    this.repository = options.repository;
    this.credentials = options.credentials;
    this.organizations = options.organizations;
    this.created = options.created;
    this.storedObjects = options.storedObjects;
    this.diagnostics = options.diagnostics;
    this.aggregateRules = options.aggregateRules;
  }

  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
    created: ProjectCreatedNoticeService;
    storedObjects?: ProjectStoredObjects;
    diagnostics?: ProjectDiagnostics;
    aggregateRules?: AggregateRuleService;
  }): ProjectWriteService {
    return new ProjectWriteService(options);
  }

  private async assertTeamCanHoldANewProject(input: {
    teamId: string;
    organizationId: string;
  }): Promise<void> {
    const [destinationTeam] = await this.findActiveTeam(input);
    if (!destinationTeam) {
      throw new TeamNotInOrganizationError("Team does not belong to this organization");
    }

    assertPersonalWorkspaceCreate(destinationTeam.isPersonal);
  }

  async create(input: {
    organizationId: string;
    userId?: string | null;
    teamId?: string;
    newTeamName?: string;
    name: string;
    language: string;
    framework: string;
    /** ADR-175: the caller has decided the actor may create an aggregate; this checks the rule. */
    kind?: CreatableProjectKind;
    /** Only read for an aggregate; defaults to the all-personal rule. */
    aggregateRule?: AggregateRule;
  }): Promise<Project> {
    if (!input.teamId && !input.newTeamName) {
      throw new ProjectCreateTargetMissingError();
    }

    // Validated before the team is created, so a refused rule writes nothing.
    const kindFields = await this.createKindFields(input);

    let teamId = input.teamId;
    if (teamId) {
      await this.assertTeamCanHoldANewProject({
        teamId,
        organizationId: input.organizationId,
      });
    } else {
      const teamName = input.newTeamName as string;
      // Organization makes the creator the new team's ADMIN, answering as the creator.
      const team = input.userId
        ? await this.organizations.createTeamWithMembers(
            {
              organizationId: input.organizationId,
              name: teamName,
              members: [{ userId: input.userId, role: "ADMIN" }],
            },
            { id: input.userId },
          )
        : await this.organizations.createTeam({
            organizationId: input.organizationId,
            name: teamName,
          });

      teamId = team.id;
    }

    const projectId = this.credentials.generateProjectId();
    const slug = mintProjectSlug(input.name, projectIdSlugToken(projectId));
    const existing = await this.repository.findBySlugInTeam({ slug, teamId });
    if (existing) {
      throw new ProjectSlugConflictError(
        "A project with this name already exists in the selected team.",
      );
    }

    const project = await this.repository.create(
      createProjectInputSchema.parse({
        id: projectId,
        name: input.name,
        slug,
        language: input.language,
        framework: input.framework,
        teamId,
        apiKey: this.credentials.generateApiKey(),
        ...kindFields,
      }),
    );
    await this.created.created({
      projectId: project.id,
      organizationId: input.organizationId,
      createdByUserId: input.userId ?? null,
      teamId: project.teamId,
      isPersonal: project.isPersonal,
    });

    return project;
  }

  /**
   * The kind columns a new project is written with: none for an ordinary
   * project, the kind and its validated rule for an aggregate, so an
   * aggregate never lands without a rule and nothing else carries one.
   */
  private async createKindFields(input: {
    organizationId: string;
    kind?: CreatableProjectKind;
    aggregateRule?: AggregateRule;
  }): Promise<{ kind?: CreatableProjectKind; aggregateRule?: AggregateRule }> {
    if (!isAggregateProjectKind(input.kind)) return {};
    if (!this.aggregateRules) {
      throw new Error("No aggregate rule service is wired; an aggregate cannot be created here");
    }
    const rule = input.aggregateRule ?? AGGREGATE_DEFAULT_RULE;
    await this.aggregateRules.assertValid({ rule, organizationId: input.organizationId });
    return { kind: PROJECT_KIND.AGGREGATE, aggregateRule: rule };
  }

  async update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project> {
    const data = input.data;
    // Read scoped to the organization: an unscoped refusal would tell a caller
    // which of another organization's projects is the governance record.
    const current = await this.repository.findWithTeam(input.id);
    const owned = current && current.team.organizationId === input.organizationId ? current : null;
    if (owned) assertNotGovernanceProject(owned.kind);

    if (data.teamId) {
      const [team] = await this.findActiveTeam({
        teamId: data.teamId,
        organizationId: input.organizationId,
      });
      if (!team) {
        throw new DestinationTeamNotFoundError(
          "Destination team not found, is archived, or belongs to a different organization",
        );
      }

      if (owned && owned.teamId !== data.teamId) {
        assertPersonalWorkspaceMove({
          isProjectPersonal: owned.isPersonal,
          isDestinationTeamPersonal: team.isPersonal,
        });
      }
    }

    const project = await this.repository.update({
      id: input.id,
      organizationId: input.organizationId,
      data,
    });
    if (owned && data.teamId && owned.teamId !== data.teamId) {
      await this.created.moved({
        projectId: input.id,
        organizationId: input.organizationId,
        fromTeamId: owned.teamId,
        toTeamId: data.teamId,
      });
    }

    return project;
  }

  async archive(input: { id: string; organizationId: string }): Promise<ArchivedProject> {
    const existing = await this.repository.findWithTeam(input.id);
    if (existing && existing.team.organizationId === input.organizationId) {
      assertNotGovernanceProject(existing.kind);
      assertPersonalProjectArchivable(existing.isPersonal);
    }

    try {
      await this.storedObjects?.deleteOwnedBy({ projectId: input.id });
    } catch (error) {
      this.diagnostics?.error(
        { projectId: input.id, error },
        "stored-object cleanup failed during project archive; continuing",
      );
    }

    const project = await this.repository.archive(input);
    await this.created.archived({ projectId: input.id, organizationId: input.organizationId });

    return project;
  }

  private async findActiveTeam(input: {
    teamId: string;
    organizationId: string;
  }): Promise<OrganizationTeam[]> {
    try {
      return [await this.organizations.getTeam(input)];
    } catch (error) {
      if (error instanceof TeamNotFoundError) return [];
      throw error;
    }
  }
}
