import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  projectWithTeamSchema,
  type ProjectService,
} from "@langwatch/project-contract";
import { ApiKeyService, type ApiKeyDependencies } from "../src/services/api-key.service";
import { ApiKeyRepository, type ApiKeyCreateRecord, type ApiKeyUpdateRecord, type StoredApiKey } from "../src/repositories/api-key.repository";
import { ApiKeyTokenAdapter } from "../src/adapters/api-key-token.api-key-token.adapter";

class MemoryApiKeys extends ApiKeyRepository {
  private rows: StoredApiKey[] = [];
  legacyProjectId: string | null = null;
  legacyProjectRotationSucceeds = true;
  regeneratedLegacyProject: { projectId: string; token: string } | null = null;
  create(input: ApiKeyCreateRecord): Promise<StoredApiKey> { const now = new Date(); const row = { ...input, id: `key-${this.rows.length + 1}`, revokedAt: input.startsDisabled ? now : null, lastUsedAt: null, createdAt: now, updatedAt: now, roleBindings: input.roleBindings.map((binding, index) => ({ ...binding, id: `binding-${index + 1}` })) } as StoredApiKey; this.rows.push(row); return Promise.resolve(row); }
  activate({ id }: { id: string }): Promise<StoredApiKey> { return this.update({ id, revokedAt: null }); }
  tryFindByLookupId({ lookupId }: { lookupId: string }): Promise<StoredApiKey | null> { return Promise.resolve(this.rows.find((row) => row.lookupId === lookupId) ?? null); }
  tryFindById({ id }: { id: string }): Promise<StoredApiKey | null> { return Promise.resolve(this.rows.find((row) => row.id === id) ?? null); }
  tryFindByIdInOrganization({ id, organizationId }: { id: string; organizationId: string }): Promise<StoredApiKey | null> { return Promise.resolve(this.rows.find((row) => row.id === id && row.organizationId === organizationId) ?? null); }
  listForUser({ organizationId, userId }: { organizationId: string; userId: string }): Promise<StoredApiKey[]> { return Promise.resolve(this.rows.filter((row) => row.organizationId === organizationId && row.revokedAt === null && (row.userId === userId || (row.userId === null && row.ingestSourceType === null)))); }
  listForOrganization({ organizationId }: { organizationId: string }): Promise<StoredApiKey[]> { return Promise.resolve(this.rows.filter((row) => row.organizationId === organizationId && row.revokedAt === null)); }
  update(input: ApiKeyUpdateRecord): Promise<StoredApiKey> { const row = this.rows.find((candidate) => candidate.id === input.id); if (!row) throw new Error("missing"); Object.assign(row, input, { updatedAt: new Date() }); if (input.roleBindings) row.roleBindings = input.roleBindings.map((binding, index) => ({ ...binding, id: `binding-${index + 1}` })); return Promise.resolve(row); }
  revoke({ id }: { id: string }): Promise<StoredApiKey> { return this.update({ id, revokedAt: new Date() }); }
  async updateLastUsedAt({ id }: { id: string }): Promise<void> { await this.update({ id, lastUsedAt: new Date() }); }
  async upgradeHash({ id, hashedSecret }: { id: string; hashedSecret: string }): Promise<void> { await this.update({ id, hashedSecret }); }
  get(id: string): StoredApiKey | undefined { return this.rows.find((row) => row.id === id); }
  tryFindIngestKey(): Promise<StoredApiKey | null> { return Promise.resolve(null); }
  findIngestKeysForProject(): Promise<StoredApiKey[]> { return Promise.resolve([]); }
  tryFindLegacyProjectId(): Promise<string | null> { return Promise.resolve(this.legacyProjectId); }
  rotateLegacyProjectKey(input: { projectId: string; token: string }): Promise<boolean> {
    this.regeneratedLegacyProject = input;
    return Promise.resolve(this.legacyProjectRotationSucceeds);
  }
  tryFindPersonalWorkspaceOwner(): Promise<{ ownerUserId: string | null } | null> { return Promise.resolve(null); }
}

const resolvedProject = projectWithTeamSchema.parse({
  id: "project-1",
  name: "Project",
  slug: "project",
  apiKey: "sk-lw-legacy",
  lwqlKey: "lwql",
  teamId: "team-1",
  language: "typescript",
  framework: "langchain",
  kind: "application",
  firstMessage: false,
  integrated: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
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
  team: {
    id: "team-1",
    name: "Team",
    slug: "team",
    organizationId: "org-1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
});

function dependencies(
  overrides: Partial<ApiKeyDependencies> = {},
): ApiKeyDependencies {
  return {
    authz: {
      can: vi.fn().mockResolvedValue(true),
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserBindings: vi.fn().mockResolvedValue([]),
      listScopeBindings: vi.fn().mockResolvedValue([]),
      listOrganizationBindings: vi.fn().mockResolvedValue([]),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    } as unknown as AuthzService,
    grants: {
      attachBindings: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
      revokeBindingsWhere: vi.fn().mockResolvedValue(0),
      defineRole: vi.fn().mockResolvedValue(undefined),
      deleteRole: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiKeyDependencies["grants"],
    organizations: {
      getTeam: vi.fn().mockResolvedValue({ id: "team-1", name: "Team" }),
      listTeams: vi.fn().mockResolvedValue({ data: [] }),
      getBillingProfile: vi.fn().mockResolvedValue({ name: "Organization" }),
    } as unknown as OrganizationService,
    projects: {
      getWithTeam: vi.fn().mockResolvedValue(resolvedProject),
      tryGetWithTeam: vi.fn().mockResolvedValue(resolvedProject),
      getById: vi.fn().mockResolvedValue(null),
      listByOrganization: vi.fn().mockResolvedValue({ data: [] }),
      listActiveByScopes: vi
        .fn()
        .mockResolvedValue({ data: [], hasMore: false }),
    } as unknown as ProjectService,
    newBindingId: () => "binding-id",
    legacyGrants: {
      mint: vi.fn(),
    } as unknown as ApiKeyDependencies["legacyGrants"],
    tokens: ApiKeyTokenAdapter.create("test-pepper"),
    ...overrides,
  };
}

describe("API-key service", () => {
  it("mints a split token and verifies it without exposing the hash", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    const created = await service.create({ name: "test", organizationId: "org-1", permissionMode: "default", bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }] });
    expect(created.token).toMatch(/^sk-lw-[^_]+_[^_]+$/);
    const verified = await service.tryVerify({ token: created.token });
    expect(verified?.id).toBe(created.apiKey.id);
    expect(verified).not.toHaveProperty("hashedSecret");
  });

  it("rejects a revoked token", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    const created = await service.create({ name: "test", organizationId: "org-1", permissionMode: "default", bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }] });
    await service.revoke({ id: created.apiKey.id, organizationId: "org-1", callerUserId: null, callerIsAdmin: true });
    expect(await service.tryVerify({ token: created.token })).toBeNull();
  });

  it("resolves a current key through its single project binding", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    const created = await service.create({
      name: "project key",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [
        { scopeType: "PROJECT", scopeId: "project-1", role: "VIEWER" },
      ],
    });

    await expect(
      service.tryResolveToken({ token: created.token }),
    ).resolves.toMatchObject({
      type: "apiKey",
      apiKeyId: created.apiKey.id,
      organizationId: "org-1",
      project: { id: "project-1" },
    });
  });

  it("falls back to the deprecated project credential after a current-shape miss", async () => {
    const repository = new MemoryApiKeys();
    repository.legacyProjectId = resolvedProject.id;
    const projects = {
      tryGetWithTeam: vi.fn().mockResolvedValue(resolvedProject),
    } as unknown as ProjectService;
    const service = new ApiKeyService(
      repository,
      dependencies({ projects }),
    );
    const token = `sk-lw-${"a".repeat(16)}_${"b".repeat(48)}`;

    await expect(service.tryResolveToken({ token })).resolves.toMatchObject({
      type: "legacyProjectKey",
      project: { id: "project-1" },
    });
    expect(projects.tryGetWithTeam).toHaveBeenCalledWith(resolvedProject.id);
  });

  it("upgrades a legacy SHA-256 hash after successful verification", async () => {
    const repository = new MemoryApiKeys();
    const service = new ApiKeyService(repository, dependencies());
    const created = await service.create({ name: "legacy", organizationId: "org-1", permissionMode: "default", bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }] });
    const secret = created.token.split("_")[1]!;
    repository.get(created.apiKey.id)!.hashedSecret = createHash("sha256").update(secret).digest("hex");

    await expect(service.tryVerify({ token: created.token })).resolves.toMatchObject({ id: created.apiKey.id });
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.get(created.apiKey.id)!.hashedSecret).not.toBe(createHash("sha256").update(secret).digest("hex"));
  });

  it("rotates the deprecated project credential through its repository", async () => {
    const repository = new MemoryApiKeys();
    const service = new ApiKeyService(repository, dependencies());

    const token = await service.regenerateLegacyProjectKey({
      projectId: "project-1",
    });
    expect(token).toMatch(/^sk-lw-[A-Za-z0-9]{48}$/);
    expect(repository.regeneratedLegacyProject).toEqual({
      projectId: "project-1",
      token,
    });
  });

  it("throws when the project credential cannot be rotated", async () => {
    const repository = new MemoryApiKeys();
    repository.legacyProjectRotationSucceeds = false;
    const service = new ApiKeyService(repository, dependencies());

    await expect(
      service.regenerateLegacyProjectKey({ projectId: "missing" }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });

  it("defaults an unowned service key to organization ADMIN", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    const created = await service.create({ name: "service", organizationId: "org-1", permissionMode: "all", bindings: [] });
    expect(created.apiKey.roleBindings).toEqual([{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN", id: "binding-1" }]);
  });

  it("refuses the hidden system name to customer callers", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    await expect(service.create({ name: "Langy session", organizationId: "org-1", permissionMode: "all", bindings: [] })).rejects.toMatchObject({ code: "api_key_reserved_name" });
  });

  it("allows the product mint to claim the hidden system name", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    await expect(service.create({ name: "Langy session", isSystemManaged: true, organizationId: "org-1", permissionMode: "all", bindings: [] })).resolves.toMatchObject({ apiKey: { name: "Langy session" } });
  });

  it("keeps system-managed keys hidden from customer mutation paths", async () => {
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies());
    const created = await service.create({ name: "Langy session", isSystemManaged: true, organizationId: "org-1", permissionMode: "all", bindings: [] });
    await expect(service.update({ id: created.apiKey.id, organizationId: "org-1", callerUserId: null, callerIsAdmin: true, name: "renamed" })).rejects.toMatchObject({ code: "api_key_not_found" });
    await expect(service.revoke({ id: created.apiKey.id, organizationId: "org-1", callerUserId: null, callerIsAdmin: true })).rejects.toMatchObject({ code: "api_key_not_found" });
  });

  it("validates the owner ceiling at the resolved project team scope", async () => {
    const can = vi.fn().mockResolvedValue(true);
    const authz = { can, hasPermission: vi.fn().mockResolvedValue(true), listUserCreatedRoles: vi.fn().mockResolvedValue([]) } as unknown as AuthzService;
    const organizations = { tryFindPersonalWorkspace: vi.fn().mockResolvedValue(null) } as unknown as OrganizationService;
    const projects = { getWithTeam: vi.fn().mockResolvedValue({ archivedAt: null, team: { id: "team-1", organizationId: "org-1" } }) } as unknown as ProjectService;
    const service = new ApiKeyService(new MemoryApiKeys(), dependencies({ authz, organizations, projects }));
    await service.create({ name: "project", userId: "user-1", organizationId: "org-1", permissionMode: "all", bindings: [{ scopeType: "PROJECT", scopeId: "project-1", role: "VIEWER" }] });
    expect(can).toHaveBeenCalledWith(expect.objectContaining({ scope: { type: "project", id: "project-1", teamId: "team-1", organizationId: "org-1" } }));
  });

  it("refuses a personal scope for a different owner or an unowned key", async () => {
    const repository = new MemoryApiKeys();
    (repository as unknown as { tryFindPersonalWorkspaceOwner: ReturnType<typeof vi.fn> }).tryFindPersonalWorkspaceOwner = vi.fn().mockResolvedValue({ ownerUserId: "owner-1" });
    const service = new ApiKeyService(repository, dependencies());
    await expect(service.create({ name: "service", organizationId: "org-1", permissionMode: "all", bindings: [{ scopeType: "TEAM", scopeId: "personal-team", role: "VIEWER" }] })).rejects.toMatchObject({ code: "api_key_scope_violation" });
  });

  it("resolves visible projects through Project candidates and one AuthZ batch", async () => {
    const repository = new MemoryApiKeys();
    const canBatchByIds = vi.fn().mockResolvedValue({
      teams: new Map(),
      projects: new Map([
        ["project-1", true],
        ["project-2", false],
      ]),
      organizationRole: null,
    });
    const authz = {
      can: vi.fn().mockResolvedValue(false),
      canBatchByIds,
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    } as unknown as AuthzService;
    const listActiveByScopes = vi.fn().mockResolvedValue({
      data: [
        resolvedProject,
        { ...resolvedProject, id: "project-2" },
      ],
      hasMore: false,
    });
    const projects = {
      getWithTeam: vi.fn().mockResolvedValue(resolvedProject),
      listActiveByScopes,
    } as unknown as ProjectService;
    const service = new ApiKeyService(
      repository,
      dependencies({ authz, projects }),
    );
    const created = await service.create({
      name: "scoped",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [
        { scopeType: "TEAM", scopeId: "team-1", role: "VIEWER" },
      ],
    });

    await expect(
      service.resolveVisibleProjects({
        apiKeyId: created.apiKey.id,
        organizationId: "org-1",
      }),
    ).resolves.toEqual({ kind: "some", ids: ["project-1"] });
    expect(listActiveByScopes).toHaveBeenCalledWith({
      organizationId: "org-1",
      organizationWide: false,
      teamIds: ["team-1"],
      projectIds: [],
      limit: 5_000,
    });
    expect(canBatchByIds).toHaveBeenCalledTimes(1);
  });

  it("returns all projects when the key and owner ceiling allow organization view", async () => {
    const repository = new MemoryApiKeys();
    const projects = {
      listActiveByScopes: vi.fn(),
    } as unknown as ProjectService;
    const service = new ApiKeyService(repository, dependencies({ projects }));
    const created = await service.create({
      name: "organization",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [],
    });

    await expect(
      service.resolveVisibleProjects({
        apiKeyId: created.apiKey.id,
        organizationId: "org-1",
      }),
    ).resolves.toEqual({ kind: "all" });
    expect(projects.listActiveByScopes).not.toHaveBeenCalled();
  });

  it("refuses to silently truncate a visibility decision", async () => {
    const repository = new MemoryApiKeys();
    const authz = {
      can: vi.fn().mockResolvedValue(false),
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    } as unknown as AuthzService;
    const projects = {
      getWithTeam: vi.fn().mockResolvedValue(resolvedProject),
      listActiveByScopes: vi
        .fn()
        .mockResolvedValue({ data: [], hasMore: true }),
    } as unknown as ProjectService;
    const service = new ApiKeyService(
      repository,
      dependencies({ authz, projects }),
    );
    const created = await service.create({
      name: "too-wide",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [
        { scopeType: "TEAM", scopeId: "team-1", role: "VIEWER" },
      ],
    });

    await expect(
      service.resolveVisibleProjects({
        apiKeyId: created.apiKey.id,
        organizationId: "org-1",
      }),
    ).rejects.toMatchObject({ code: "project_visibility_too_wide" });
  });
});
