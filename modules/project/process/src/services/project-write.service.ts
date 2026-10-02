import {
  type OrganizationApi,
  type OrganizationTeam,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import {
  ProjectCreateTargetMissingError,
  createProjectInputSchema,
  type ArchivedProject,
  type Project,
  type UpdateProjectInput,
  DestinationTeamNotFoundError,
  assertPersonalProjectArchivable,
  assertPersonalWorkspaceCreate,
  assertPersonalWorkspaceMove,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
} from "@langwatch/project-contract";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import { mintProjectSlug, projectIdSlugToken } from "../rules/project-slug-service.rules.ts";
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

  private constructor(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
    created: ProjectCreatedNoticeService;
    storedObjects?: ProjectStoredObjects;
    diagnostics?: ProjectDiagnostics;
  }) {
    this.repository = options.repository;
    this.credentials = options.credentials;
    this.organizations = options.organizations;
    this.created = options.created;
    this.storedObjects = options.storedObjects;
    this.diagnostics = options.diagnostics;
  }

  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
    created: ProjectCreatedNoticeService;
    storedObjects?: ProjectStoredObjects;
    diagnostics?: ProjectDiagnostics;
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
  }): Promise<Project> {
    if (!input.teamId && !input.newTeamName) {
      throw new ProjectCreateTargetMissingError();
    }

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
      }),
    );
    await this.created.created({
      projectId: project.id,
      organizationId: input.organizationId,
      createdByUserId: input.userId ?? null,
    });

    return project;
  }

  async update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project> {
    const data = input.data;
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

      const current = await this.repository.findWithTeam(input.id);
      if (
        current &&
        current.team.organizationId === input.organizationId &&
        current.teamId !== data.teamId
      ) {
        assertPersonalWorkspaceMove({
          isProjectPersonal: current.isPersonal,
          isDestinationTeamPersonal: team.isPersonal,
        });
      }
    }

    const project = await this.repository.update({
      id: input.id,
      organizationId: input.organizationId,
      data,
    });

    return project;
  }

  async archive(input: { id: string; organizationId: string }): Promise<ArchivedProject> {
    const existing = await this.repository.findWithTeam(input.id);
    if (existing && existing.team.organizationId === input.organizationId) {
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
