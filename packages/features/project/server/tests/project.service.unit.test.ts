import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  PROJECT_KIND,
  projectSchema,
  type InternalProject,
  type Project,
  type ProjectIdentity,
  type ProjectWithTeam,
  type TraceDestinationProject,
} from "@langwatch/project-contract";
import {
  OrganizationHasNoTeamError,
  OrganizationService as OrganizationServiceContract,
  type AddOrganizationTeamMemberInput,
  type CreateOrganizationTeamInput,
  type OrganizationBillingProfile,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";
import { ProjectCredentialsPort } from "../src/ports/project.port";
import { ProjectRepository } from "../src/repositories/project.repository";
import { ProjectService } from "../src/services/project.service";

const project: InternalProject = {
  id: "governance-project",
  name: "Governance (internal)",
  slug: "governance-org",
  teamId: "oldest-team",
  kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
  archivedAtMs: null,
  traceSharingEnabled: false,
};

const applicationProject: Project = projectSchema.parse({
  id: "project_1",
  name: "Application",
  slug: "application-abc123",
  apiKey: "api-key",
  lwqlKey: "lwql-key",
  teamId: "team_1",
  language: "typescript",
  framework: "langchain",
  kind: PROJECT_KIND.APPLICATION,
  firstMessage: false,
  integrated: false,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
  userLinkTemplate: null,
  traceSharingEnabled: true,
  presenceEnabled: true,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
});

const traceDestination = {
  id: "trace_project",
  teamId: "trace_team",
  apiKey: "trace-api-key",
  archivedAt: null,
};

const projectWithTeam = (overrides: Partial<ProjectWithTeam> = {}): ProjectWithTeam => ({
  ...applicationProject,
  team: {
    id: "team_1",
    name: "Team",
    slug: "team",
    organizationId: "org",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
  ...overrides,
});

class StubRepository extends ProjectRepository {
  existing: InternalProject | null = null;
  tryFindInternalByOrganization = vi.fn(async () => this.existing);
  tryFindInternalBySlug = vi.fn(async () => null);
  createInternalOrFindWinner = vi.fn(async () => project);
  isPresenceEnabled = vi.fn(async () => true);
  tryFindActiveTeamInOrganization = vi.fn<
    () => Promise<{ id: string; isPersonal: boolean } | null>
  >(async () => ({ id: "team_1", isPersonal: false }));
  tryFindBySlugInTeam = vi.fn(async () => null);
  findAllByTeam = vi.fn(async () => [applicationProject]);
  findNamesByIds = vi.fn<(projectIds: string[]) => Promise<ProjectIdentity[]>>(async () => []);
  tryFindIdentity = vi.fn<(id: string) => Promise<ProjectIdentity | null>>(async () => null);
  findIdsByOrganization = vi.fn<(organizationId: string) => Promise<string[]>>(async () => []);
  create = vi.fn(async () => applicationProject);
  tryGetById = vi.fn(async () => applicationProject);
  tryGetOrganizationId = vi.fn<(projectId: string) => Promise<string | undefined>>(
    async () => "org",
  );
  tryGetWithTeam = vi.fn<(id: string) => Promise<ProjectWithTeam | null>>(async () => null);
  updateMetadata = vi.fn(async () => undefined);
  touchCodingAgentSessionSeen = vi.fn(async () => undefined);
  touchCodingAgentPullRequestSeen = vi.fn(async () => undefined);
  tryGetWithOrgAdmin = vi.fn(async () => null);
  tryGetTraceSharingConfig = vi.fn(async () => null);
  searchByQuery = vi.fn(async () => []);
  update = vi.fn(async () => applicationProject);
  archive = vi.fn(async () => applicationProject);
  findAllByOrganization = vi.fn(async () => ({
    data: [applicationProject],
    pagination: { page: 1, limit: 50, total: 1 },
  }));
  findActiveByScopes = vi.fn(async () => [applicationProject]);
  tryFindLiveTraceDestination = vi.fn(
    async (_input: {
      organizationId: string;
      projectId: string;
    }): Promise<TraceDestinationProject | null> => null,
  );
  tryFindOldestGovernanceTraceDestination = vi.fn(
    async (_organizationId: string): Promise<TraceDestinationProject | null> => null,
  );
  countLiveNonGovernanceProjects = vi.fn(async () => 0);
  tryGetTraceDestination = vi.fn(async () => null);
  listTraceDestinations = vi.fn(async () => []);
}

class StubOrganizationService extends OrganizationServiceContract {
  teamId: string | null = "oldest-team";
  readonly createdTeams: CreateOrganizationTeamInput[] = [];
  readonly addedTeamMembers: AddOrganizationTeamMemberInput[] = [];

  getOrganizationMembers(): Promise<string[]> {
    return Promise.resolve([]);
  }

  isMember(): Promise<boolean> {
    return Promise.resolve(false);
  }

  getSettings(): never {
    throw new Error("not used by this test");
  }

  updateSettings(): never {
    throw new Error("not used by this test");
  }

  async getOldestTeamId(): Promise<string> {
    if (!this.teamId) throw new OrganizationHasNoTeamError("org");
    return this.teamId;
  }

  getBillingProfile(): Promise<OrganizationBillingProfile> {
    throw new Error("not used by this test");
  }

  claimBillingCustomerId(): Promise<boolean> {
    throw new Error("not used by this test");
  }

  ensurePersonalWorkspace(): Promise<never> {
    throw new Error("not used by this test");
  }

  tryFindPersonalWorkspace(): Promise<never> {
    throw new Error("not used by this test");
  }

  getPersonalWorkspaceFeatures(): Promise<never> {
    throw new Error("not used by this test");
  }

  enableAllPersonalWorkspaceFeatures(): Promise<never> {
    throw new Error("not used by this test");
  }

  disableAllPersonalWorkspaceFeatures(): Promise<never> {
    throw new Error("not used by this test");
  }

  getTeam(): Promise<never> {
    throw new Error("not used by this test");
  }

  listTeams(): Promise<never> {
    throw new Error("not used by this test");
  }

  createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam> {
    this.createdTeams.push(input);
    return Promise.resolve({
      id: "team_new",
      name: input.name,
      slug: "new-team",
      organizationId: input.organizationId,
      isPersonal: false,
      ownerUserId: null,
      archivedAt: null,
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
  }

  updateTeam(): Promise<never> {
    throw new Error("not used by this test");
  }

  archiveTeam(): Promise<never> {
    throw new Error("not used by this test");
  }

  addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void> {
    this.addedTeamMembers.push(input);
    return Promise.resolve();
  }

  removeTeamMember(): Promise<never> {
    throw new Error("not used by this test");
  }

  getTeamById(): Promise<never> {
    throw new Error("not used by this test");
  }

  getTeamBySlugForMember(): Promise<never> {
    throw new Error("not used by this test");
  }

  getTeamWithMembers(): Promise<never> {
    throw new Error("not used by this test");
  }

  listTeamsWithMembers(): Promise<never> {
    throw new Error("not used by this test");
  }

  createTeamWithMembers(): Promise<never> {
    throw new Error("not used by this test");
  }

  updateTeamWithMembers(): Promise<never> {
    throw new Error("not used by this test");
  }

  listTeamAccess(): Promise<never> {
    throw new Error("not used by this test");
  }

  getGroup(): Promise<never> {
    throw new Error("not used by this test");
  }

  listGroups(): Promise<never> {
    throw new Error("not used by this test");
  }

  listGroupsForMember(): Promise<never> {
    throw new Error("not used by this test");
  }

  createGroup(): Promise<never> {
    throw new Error("not used by this test");
  }

  renameGroup(): Promise<never> {
    throw new Error("not used by this test");
  }

  deleteGroup(): Promise<never> {
    throw new Error("not used by this test");
  }

  addGroupMember(): Promise<never> {
    throw new Error("not used by this test");
  }

  removeGroupMember(): Promise<never> {
    throw new Error("not used by this test");
  }

  listGroupBindings(): Promise<never> {
    throw new Error("not used by this test");
  }

  addGroupBinding(): Promise<never> {
    throw new Error("not used by this test");
  }

  removeGroupBinding(): Promise<never> {
    throw new Error("not used by this test");
  }

  applyGroupEdits(): Promise<never> {
    throw new Error("not used by this test");
  }
}

class FixedCredentials extends ProjectCredentialsPort {
  generateProjectId(): string {
    return "governance-project";
  }

  generateApiKey(): string {
    return "secret-api-key";
  }
}

const createService = (
  repository: StubRepository,
  organizations = new StubOrganizationService(),
): ProjectService =>
  ProjectService.create({
    repository,
    credentials: new FixedCredentials(),
    organizations,
  });

describe("ProjectService", () => {
  it("resolves a live explicit trace destination without falling back", async () => {
    const repository = new StubRepository();
    repository.tryFindLiveTraceDestination.mockResolvedValue(traceDestination);

    await expect(
      createService(repository).resolveTraceDestination({
        organizationId: "org",
        projectScopeIds: ["other"],
        traceProjectId: traceDestination.id,
      }),
    ).resolves.toEqual({ outcome: "resolved", project: traceDestination });
    expect(repository.tryFindOldestGovernanceTraceDestination).not.toHaveBeenCalled();
  });

  it("rejects an explicit trace destination outside the live organization", async () => {
    const repository = new StubRepository();

    await expect(
      createService(repository).resolveTraceDestination({
        organizationId: "org",
        projectScopeIds: [],
        traceProjectId: "missing",
      }),
    ).resolves.toEqual({ outcome: "unknown" });
    expect(repository.tryFindOldestGovernanceTraceDestination).not.toHaveBeenCalled();
  });

  it("uses the only live project scope as the trace destination", async () => {
    const repository = new StubRepository();
    repository.tryFindLiveTraceDestination.mockResolvedValue(traceDestination);

    await expect(
      createService(repository).resolveTraceDestination({
        organizationId: "org",
        projectScopeIds: [traceDestination.id],
      }),
    ).resolves.toEqual({ outcome: "resolved", project: traceDestination });
  });

  it("uses the oldest governance destination when there is no alternative", async () => {
    const repository = new StubRepository();
    repository.tryFindOldestGovernanceTraceDestination.mockResolvedValue(traceDestination);

    await expect(
      createService(repository).resolveTraceDestination({
        organizationId: "org",
        projectScopeIds: [],
      }),
    ).resolves.toEqual({ outcome: "resolved", project: traceDestination });
  });

  it("reports ambiguity when a governance fallback would hide live alternatives", async () => {
    const repository = new StubRepository();
    repository.tryFindOldestGovernanceTraceDestination.mockResolvedValue(traceDestination);
    repository.countLiveNonGovernanceProjects.mockResolvedValue(1);

    await expect(
      createService(repository).resolveTraceDestination({
        organizationId: "org",
        projectScopeIds: ["a", "b"],
      }),
    ).resolves.toEqual({ outcome: "ambiguous", projectScopeCount: 2 });
  });

  it("reports no trace destination when there is no governance project", async () => {
    const repository = new StubRepository();

    await expect(
      createService(repository).resolveTraceDestination({
        organizationId: "org",
        projectScopeIds: [],
      }),
    ).resolves.toEqual({ outcome: "no_destination" });
    expect(repository.countLiveNonGovernanceProjects).not.toHaveBeenCalled();
  });

  it("returns the existing internal project without creating", async () => {
    const repository = new StubRepository();
    repository.existing = project;

    await expect(
      createService(repository).ensureInternal({
        organizationId: "org",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      }),
    ).resolves.toBe(project);
    expect(repository.createInternalOrFindWinner).not.toHaveBeenCalled();
  });

  it("creates the internal project on the oldest team", async () => {
    const repository = new StubRepository();

    await expect(
      createService(repository).ensureInternal({
        organizationId: "org",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      }),
    ).resolves.toEqual(project);
    expect(repository.createInternalOrFindWinner).toHaveBeenCalledWith({
      id: "governance-project",
      name: "Governance (internal)",
      slug: "governance-org",
      apiKey: "secret-api-key",
      teamId: "oldest-team",
    });
  });

  it("rejects an organization with no team", async () => {
    const repository = new StubRepository();
    const organizations = new StubOrganizationService();
    organizations.teamId = null;

    await expect(
      createService(repository, organizations).ensureInternal({
        organizationId: "org",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      }),
    ).rejects.toBeInstanceOf(OrganizationHasNoTeamError);
  });

  it("delegates the effective presence decision to Project persistence", async () => {
    const repository = new StubRepository();

    await expect(
      createService(repository).isPresenceEnabled({ projectId: "project-1" }),
    ).resolves.toBe(true);
    expect(repository.isPresenceEnabled).toHaveBeenCalledWith("project-1");
  });

  it("returns the project organization through the throwing Project service", async () => {
    const repository = new StubRepository();
    repository.tryGetWithTeam.mockResolvedValue({
      ...applicationProject,
      team: {
        id: "team_1",
        name: "Team",
        slug: "team",
        organizationId: "org",
        createdAt: new Date(0),
        updatedAt: new Date(0),
        archivedAt: null,
        isPersonal: false,
        ownerUserId: null,
        departmentId: null,
      },
    });

    await expect(createService(repository).getOrganizationId("project_1")).resolves.toBe("org");
  });

  it("returns absence for a missing or orphaned compatibility tenant lookup", async () => {
    const repository = new StubRepository();
    repository.tryGetOrganizationId.mockResolvedValue(undefined);

    await expect(createService(repository).tryGetOrganizationId("project_missing")).resolves.toBe(
      undefined,
    );
    expect(repository.tryGetOrganizationId).toHaveBeenCalledWith("project_missing");
  });

  it("creates an application project through its own repository", async () => {
    const repository = new StubRepository();

    await expect(
      createService(repository).create({
        organizationId: "org",
        teamId: "team_1",
        name: "Application",
        language: "typescript",
        framework: "langchain",
      }),
    ).resolves.toBe(applicationProject);

    expect(repository.tryFindActiveTeamInOrganization).toHaveBeenCalledWith({
      teamId: "team_1",
      organizationId: "org",
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project_governance-project",
        teamId: "team_1",
        name: "Application",
      }),
    );
  });

  it("asks Organization to create and grant a new team", async () => {
    const repository = new StubRepository();
    const organizations = new StubOrganizationService();

    await createService(repository, organizations).create({
      organizationId: "org",
      userId: "user",
      newTeamName: "New Team",
      name: "Application",
      language: "typescript",
      framework: "langchain",
    });

    expect(organizations.createdTeams).toEqual([{ organizationId: "org", name: "New Team" }]);
    expect(organizations.addedTeamMembers).toEqual([
      {
        organizationId: "org",
        teamId: "team_new",
        userId: "user",
        role: "ADMIN",
        actor: { type: "user", id: "user" },
      },
    ]);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team_new" }));
  });

  it("lists team projects through Project persistence", async () => {
    const repository = new StubRepository();
    await expect(
      createService(repository).listByTeam({
        organizationId: "org",
        teamId: "team_1",
      }),
    ).resolves.toEqual([applicationProject]);
    expect(repository.findAllByTeam).toHaveBeenCalledWith({
      organizationId: "org",
      teamId: "team_1",
    });
  });

  it("loads project names in one deduplicated repository call", async () => {
    const repository = new StubRepository();
    repository.findNamesByIds.mockResolvedValue([
      {
        id: "project_1",
        name: "First",
        slug: "first",
        teamId: "team_1",
        organizationId: "org",
      },
      {
        id: "project_2",
        name: "Second",
        slug: "second",
        teamId: "team_2",
        organizationId: "org",
      },
    ]);

    await expect(
      createService(repository).listNamesByIds({
        projectIds: ["project_1", "project_2", "project_1"],
      }),
    ).resolves.toEqual([
      {
        id: "project_1",
        name: "First",
        slug: "first",
        teamId: "team_1",
        organizationId: "org",
      },
      {
        id: "project_2",
        name: "Second",
        slug: "second",
        teamId: "team_2",
        organizationId: "org",
      },
    ]);
    expect(repository.findNamesByIds).toHaveBeenCalledWith(["project_1", "project_2"]);
  });

  it("lists durable project ids for an organization", async () => {
    const repository = new StubRepository();
    repository.findIdsByOrganization.mockResolvedValue(["project_1", "project_2"]);

    await expect(
      createService(repository).listIdsByOrganization({ organizationId: "org" }),
    ).resolves.toEqual(["project_1", "project_2"]);
    expect(repository.findIdsByOrganization).toHaveBeenCalledWith("org");
  });

  it("bounds active project scope queries and reports another page", async () => {
    const repository = new StubRepository();
    repository.findActiveByScopes.mockResolvedValue([
      applicationProject,
      { ...applicationProject, id: "project_2" },
    ]);

    await expect(
      createService(repository).listActiveByScopes({
        organizationId: "org",
        organizationWide: false,
        teamIds: ["team_1"],
        projectIds: [],
        limit: 1,
      }),
    ).resolves.toEqual({ data: [applicationProject], hasMore: true });
    expect(repository.findActiveByScopes).toHaveBeenCalledWith({
      organizationId: "org",
      organizationWide: false,
      teamIds: ["team_1"],
      projectIds: [],
      limit: 1,
    });
  });

  it("does not hit persistence when no project scope can match", async () => {
    const repository = new StubRepository();

    await expect(
      createService(repository).listActiveByScopes({
        organizationId: "org",
        organizationWide: false,
        teamIds: [],
        projectIds: [],
        limit: 10,
      }),
    ).resolves.toEqual({ data: [], hasMore: false });
    expect(repository.findActiveByScopes).not.toHaveBeenCalled();
  });

  it("does not allow an application project into a personal workspace", async () => {
    const repository = new StubRepository();
    repository.tryFindActiveTeamInOrganization.mockResolvedValue({
      id: "personal-team",
      isPersonal: true,
    });

    await expect(
      createService(repository).create({
        organizationId: "org",
        teamId: "personal-team",
        name: "Second project",
        language: "typescript",
        framework: "langchain",
      }),
    ).rejects.toThrow("Projects cannot be created in a personal workspace");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("updates without looking up a destination team when teamId is absent", async () => {
    const repository = new StubRepository();

    await createService(repository).update({
      id: applicationProject.id,
      organizationId: "org",
      data: { name: "Renamed" },
    });

    expect(repository.tryFindActiveTeamInOrganization).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith({
      id: applicationProject.id,
      organizationId: "org",
      data: { name: "Renamed" },
    });
  });

  it("rejects an unavailable destination team", async () => {
    const repository = new StubRepository();
    repository.tryFindActiveTeamInOrganization.mockResolvedValue(null);

    await expect(
      createService(repository).update({
        id: applicationProject.id,
        organizationId: "org",
        data: { teamId: "missing" },
      }),
    ).rejects.toBeInstanceOf(DestinationTeamNotFoundError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      current: projectWithTeam({ isPersonal: true, teamId: "personal" }),
      destination: { id: "shared", isPersonal: false },
    },
    {
      current: projectWithTeam({ isPersonal: false, teamId: "shared" }),
      destination: { id: "personal", isPersonal: true },
    },
  ])("rejects moves across the personal-workspace boundary", async ({ current, destination }) => {
    const repository = new StubRepository();
    repository.tryGetWithTeam.mockResolvedValue(current);
    repository.tryFindActiveTeamInOrganization.mockResolvedValue(destination);

    await expect(
      createService(repository).update({
        id: current.id,
        organizationId: "org",
        data: { teamId: destination.id },
      }),
    ).rejects.toBeInstanceOf(PersonalWorkspaceBoundaryError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("allows an update that names the current personal team", async () => {
    const repository = new StubRepository();
    repository.tryGetWithTeam.mockResolvedValue(
      projectWithTeam({ isPersonal: true, teamId: "personal" }),
    );
    repository.tryFindActiveTeamInOrganization.mockResolvedValue({
      id: "personal",
      isPersonal: true,
    });

    await expect(
      createService(repository).update({
        id: applicationProject.id,
        organizationId: "org",
        data: { name: "My Workspace", teamId: "personal" },
      }),
    ).resolves.toBe(applicationProject);
  });

  it("refuses to archive a personal project", async () => {
    const repository = new StubRepository();
    repository.tryGetWithTeam.mockResolvedValue(projectWithTeam({ isPersonal: true }));

    await expect(
      createService(repository).archive({
        id: applicationProject.id,
        organizationId: "org",
      }),
    ).rejects.toBeInstanceOf(PersonalProjectProtectedError);
    expect(repository.archive).not.toHaveBeenCalled();
  });

  it("mints a slug from the name and generated project id", async () => {
    const repository = new StubRepository();

    await createService(repository).create({
      organizationId: "org",
      teamId: "team_1",
      name: "Governance & Insights",
      language: "typescript",
      framework: "langchain",
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "governance-insights-govern" }),
    );
  });

  it("keeps coding-agent activity columns on independent clocks", async () => {
    const repository = new StubRepository();
    const at = new Date("2026-08-25T12:00:00.000Z");
    const service = createService(repository);

    await service.touchCodingAgentSessionSeen({
      projectId: applicationProject.id,
      at,
    });
    await service.touchCodingAgentPullRequestSeen({
      projectId: applicationProject.id,
      at,
    });

    const expected = {
      projectId: applicationProject.id,
      at,
      staleBefore: new Date("2026-08-25T11:00:00.000Z"),
    };
    expect(repository.touchCodingAgentSessionSeen).toHaveBeenCalledWith(expected);
    expect(repository.touchCodingAgentPullRequestSeen).toHaveBeenCalledWith(expected);
  });
});
