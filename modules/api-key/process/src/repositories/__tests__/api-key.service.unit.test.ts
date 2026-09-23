import { createHash } from "node:crypto";

import { createApiFixture } from "@langwatch/api-fixture";
import { ApiKeyNotFoundError, type ApiKeyBinding } from "@langwatch/api-key-contract";
import type {
  AuthzAccessBinding,
  AuthzApi,
  AuthzListApiKeyBindingsInput,
} from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  projectIdentitySchema,
  projectWithTeamSchema,
  type ProjectApi,
} from "@langwatch/project-contract";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyBindingId } from "../../services/api-key-binding-id.service.ts";
import { ApiKeyService, type ApiKeyDependencies } from "../../services/api-key.service.ts";
import {
  ApiKeyRepository,
  type ApiKeyCreateRecord,
  type ApiKeyRow,
  type ApiKeyUpdateRecord,
} from "../api-key.repository.ts";
import { ApiKeyTokenAdapter } from "../memory/memory.api-key-token.repository.ts";

class TestApiKeyBindingId implements ApiKeyBindingId {
  static create(): TestApiKeyBindingId {
    return new TestApiKeyBindingId();
  }

  private constructor() {}

  generateBindingId(): string {
    return "binding-id";
  }
}

/** What the grants side holds for each key; the service joins it, as it joins the grants head. */
const KEY_GRANTS = new Map<string, ApiKeyBinding[]>();

beforeEach(() => KEY_GRANTS.clear());

function grantKey(id: string, bindings: ApiKeyCreateRecord["roleBindings"]): void {
  KEY_GRANTS.set(
    id,
    bindings.map((binding, index) => ({
      ...binding,
      customRoleId: binding.customRoleId ?? null,
      id: `binding-${index + 1}`,
    })),
  );
}

async function listApiKeyBindings({
  organizationId,
  apiKeyIds,
}: AuthzListApiKeyBindingsInput): Promise<AuthzAccessBinding[]> {
  return apiKeyIds.flatMap((apiKeyId) =>
    (KEY_GRANTS.get(apiKeyId) ?? []).map((binding) => ({
      ...binding,
      organizationId,
      userId: null,
      groupId: null,
      apiKeyId,
      createdAt: new Date(0),
      user: null,
      group: null,
      apiKey: null,
      customRole: null,
    })),
  );
}

class MemoryApiKeys extends ApiKeyRepository {
  private rows: ApiKeyRow[] = [];
  create(input: ApiKeyCreateRecord): Promise<ApiKeyRow> {
    const now = toDate(nowInstant());
    const { roleBindings, startsDisabled, ...record } = input;
    const row: ApiKeyRow = {
      ...record,
      createdByDeviceLabel: record.createdByDeviceLabel ?? null,
      parentApiKeyId: record.parentApiKeyId ?? null,
      revocationCause: null,
      expiresAt: input.expiresAt ? toDate(input.expiresAt) : null,
      id: `key-${this.rows.length + 1}`,
      revokedAt: startsDisabled ? now : null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    grantKey(row.id, roleBindings);
    this.rows.push(row);
    return Promise.resolve(row);
  }
  activate({ id }: { id: string }): Promise<ApiKeyRow> {
    return this.update({ id, revokedAt: null });
  }
  revokeExpiredByName({ name, now }: { name: string; now: Instant }): Promise<number> {
    const matched = this.rows.filter(
      (row) =>
        row.name === name &&
        row.revokedAt === null &&
        row.expiresAt !== null &&
        row.expiresAt.getTime() <= now.epochMilliseconds,
    );
    for (const row of matched) row.revokedAt = toDate(now);
    return Promise.resolve(matched.length);
  }
  findByLookupId({ lookupId }: { lookupId: string }): Promise<ApiKeyRow | null> {
    return Promise.resolve(this.rows.find((row) => row.lookupId === lookupId) ?? null);
  }
  findById({ id }: { id: string }): Promise<ApiKeyRow | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  findByIdInOrganization({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<ApiKeyRow | null> {
    return Promise.resolve(
      this.rows.find((row) => row.id === id && row.organizationId === organizationId) ?? null,
    );
  }
  listForUser({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<ApiKeyRow[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.organizationId === organizationId &&
          row.revokedAt === null &&
          (row.userId === userId || (row.userId === null && row.ingestSourceType === null)),
      ),
    );
  }
  listForOrganization({ organizationId }: { organizationId: string }): Promise<ApiKeyRow[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.organizationId === organizationId && row.revokedAt === null),
    );
  }
  update(input: ApiKeyUpdateRecord): Promise<ApiKeyRow> {
    const row = this.rows.find((candidate) => candidate.id === input.id);
    if (!row) throw new Error("missing");
    const { roleBindings, ...columns } = input;
    Object.assign(row, columns, {
      updatedAt: toDate(nowInstant()),
      ...(input.revokedAt === void 0
        ? {}
        : { revokedAt: input.revokedAt && toDate(input.revokedAt) }),
      ...(input.lastUsedAt === void 0 ? {} : { lastUsedAt: toDate(input.lastUsedAt) }),
    });
    if (roleBindings) grantKey(row.id, roleBindings);
    return Promise.resolve(row);
  }
  revoke({ id }: { id: string }): Promise<ApiKeyRow> {
    return this.update({ id, revokedAt: nowInstant() });
  }
  async updateLastUsedAt({ id }: { id: string }): Promise<void> {
    await this.update({ id, lastUsedAt: nowInstant() });
  }
  async upgradeHash({ id, hashedSecret }: { id: string; hashedSecret: string }): Promise<void> {
    await this.update({ id, hashedSecret });
  }
  get(id: string): ApiKeyRow | undefined {
    return this.rows.find((row) => row.id === id);
  }
  findIngestKey(): Promise<ApiKeyRow | null> {
    return Promise.resolve(null);
  }
  findIngestKeys(): Promise<ApiKeyRow[]> {
    return Promise.resolve([]);
  }
  findLiveChildren(input: {
    parentApiKeyId: string;
    organizationId: string;
  }): Promise<{ id: string }[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.parentApiKeyId === input.parentApiKeyId &&
            row.organizationId === input.organizationId &&
            row.revokedAt === null,
        )
        .map(({ id }) => ({ id })),
    );
  }
  findLivenessById(input: {
    id: string;
  }): Promise<{ revokedAt: Instant | null; expiresAt: Instant | null } | null> {
    const row = this.rows.find(({ id }) => id === input.id);
    return Promise.resolve(
      row
        ? {
            revokedAt: row.revokedAt ? fromDate(row.revokedAt) : null,
            expiresAt: row.expiresAt ? fromDate(row.expiresAt) : null,
          }
        : null,
    );
  }
  findElapsedLoginKeys(input: {
    now: Instant;
  }): Promise<{ id: string; userId: string | null; organizationId: string }[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) => row.expiresAt !== null && row.expiresAt.getTime() <= input.now.epochMilliseconds,
        )
        .map(({ id, userId, organizationId }) => ({ id, userId, organizationId })),
    );
  }
  async extendLoginKeyExpiry(input: {
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Instant;
  }): Promise<void> {
    const row = this.rows.find(
      ({ id, organizationId, userId }) =>
        id === input.id && organizationId === input.organizationId && userId === input.userId,
    );
    if (row && row.revokedAt === null) row.expiresAt = toDate(input.expiresAt);
  }
}

/**
 * The Project peer as the API-key services ask it now: the legacy project
 * credential and personal-workspace ownership are the project module's rows,
 * so a test that used to seed them on the key repository seeds them here.
 */
class MemoryProjects {
  legacyProjectId: string | null = null;
  legacyProjectRotationSucceeds = true;
  rotated: { projectId: string; token: string } | null = null;
  personalWorkspaceOwner: { ownerUserId: string | null } | null = null;

  findIdByLegacyApiKey(): Promise<string | null> {
    return Promise.resolve(this.legacyProjectId);
  }
  rotateLegacyApiKey(input: { projectId: string; token: string }): Promise<boolean> {
    this.rotated = input;
    return Promise.resolve(this.legacyProjectRotationSucceeds);
  }
  findPersonalWorkspaceOwner(): Promise<{ ownerUserId: string | null } | null> {
    return Promise.resolve(this.personalWorkspaceOwner);
  }
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

/**
 * What token resolution actually reads back for a project: five indexed
 * columns and the organization flat, rather than the whole row it used to
 * carry through the boundary.
 */
const resolvedIdentity = projectIdentitySchema.parse({
  id: resolvedProject.id,
  name: resolvedProject.name,
  slug: resolvedProject.slug,
  teamId: resolvedProject.teamId,
  organizationId: resolvedProject.team.organizationId,
  isPersonal: false,
  ownerUserId: null,
});

/** The project directory a key service reads, over one in-memory peer. */
function projectPeer(memory: MemoryProjects): ProjectApi {
  return {
    getWithTeam: vi.fn().mockResolvedValue(resolvedProject),
    findWithTeam: vi.fn().mockResolvedValue(resolvedProject),
    findIdentity: vi.fn().mockResolvedValue(resolvedIdentity),
    getById: vi.fn().mockResolvedValue(null),
    listByOrganization: vi.fn().mockResolvedValue({ data: [] }),
    listActiveByScopes: vi.fn().mockResolvedValue({ data: [], hasMore: false }),
    findIdByLegacyApiKey: () => memory.findIdByLegacyApiKey(),
    rotateLegacyApiKey: (input: { projectId: string; token: string }) =>
      memory.rotateLegacyApiKey(input),
    findPersonalWorkspaceOwner: () => memory.findPersonalWorkspaceOwner(),
  } as unknown as ProjectApi;
}

function dependencies(overrides: Partial<ApiKeyDependencies> = {}): ApiKeyDependencies {
  return {
    authz: createApiFixture<AuthzApi>({
      listApiKeyBindings,
      can: vi.fn().mockResolvedValue(true),
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserBindings: vi.fn().mockResolvedValue([]),
      listScopeBindings: vi.fn().mockResolvedValue([]),
      listOrganizationBindings: vi.fn().mockResolvedValue([]),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    }),
    grants: createApiFixture<AuthzApi>({
      attachBindings: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
      revokeBindingsWhere: vi.fn().mockResolvedValue(0),
      defineRole: vi.fn().mockResolvedValue(undefined),
      deleteRole: vi.fn().mockResolvedValue(undefined),
    }),
    organizations: createApiFixture<OrganizationApi>({
      getTeam: vi.fn().mockResolvedValue({ id: "team-1", name: "Team" }),
      listTeams: vi.fn().mockResolvedValue({ data: [] }),
      getBillingProfile: vi.fn().mockResolvedValue({ name: "Organization" }),
    }),
    projects: projectPeer(new MemoryProjects()),
    bindingIds: TestApiKeyBindingId.create(),
    legacyGrants: {
      mint: vi.fn(),
    } as unknown as ApiKeyDependencies["legacyGrants"],
    tokens: ApiKeyTokenAdapter.create("test-pepper"),
    ...overrides,
  };
}

function createService(
  repository: ApiKeyRepository = new MemoryApiKeys(),
  options: ApiKeyDependencies = dependencies(),
): ApiKeyService {
  return ApiKeyService.create({ repository, ...options });
}

describe("API-key service", () => {
  it("mints a split token and verifies it without exposing the hash", async () => {
    const service = createService();
    const created = await service.create({
      name: "test",
      organizationId: "org-1",
      permissionMode: "default",
      bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }],
    });
    expect(created.token).toMatch(/^sk-lw-[^_]+_[^_]+$/);
    const verified = await service.findVerifiedToken({ token: created.token });
    expect(verified?.id).toBe(created.apiKey.id);
    expect(verified).not.toHaveProperty("hashedSecret");
  });

  it("rejects a revoked token", async () => {
    const service = createService();
    const created = await service.create({
      name: "test",
      organizationId: "org-1",
      permissionMode: "default",
      bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }],
    });
    await service.revoke({
      id: created.apiKey.id,
      organizationId: "org-1",
      callerUserId: null,
      callerIsAdmin: true,
    });
    expect(await service.findVerifiedToken({ token: created.token })).toBeNull();
  });

  it("resolves a current key through its single project binding", async () => {
    const service = createService();
    const created = await service.create({
      name: "project key",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "PROJECT", scopeId: "project-1", role: "VIEWER" }],
    });

    await expect(service.findResolvedToken({ token: created.token })).resolves.toMatchObject({
      type: "apiKey",
      apiKeyId: created.apiKey.id,
      organizationId: "org-1",
      project: { id: "project-1" },
    });
  });

  it("falls back to the deprecated project credential after a current-shape miss", async () => {
    const memory = new MemoryProjects();
    memory.legacyProjectId = resolvedProject.id;
    const findIdentity = vi.fn().mockResolvedValue(resolvedIdentity);
    const projects = { ...projectPeer(memory), findIdentity };
    const service = createService(new MemoryApiKeys(), dependencies({ projects }));
    const token = `sk-lw-${"a".repeat(16)}_${"b".repeat(48)}`;

    await expect(service.findResolvedToken({ token })).resolves.toMatchObject({
      type: "legacyProjectKey",
      project: { id: "project-1" },
    });
    expect(findIdentity).toHaveBeenCalledWith(resolvedProject.id);
  });

  it("keeps a deprecated project credential bound to its resolved project", async () => {
    const memory = new MemoryProjects();
    memory.legacyProjectId = resolvedProject.id;
    const service = createService(
      new MemoryApiKeys(),
      dependencies({ projects: projectPeer(memory) }),
    );

    await expect(
      service.findResolvedToken({ token: "sk-lw-legacy-token", projectId: "other-project" }),
    ).resolves.toMatchObject({
      type: "legacyProjectKey",
      project: { id: resolvedProject.id },
    });
  });

  it("allows a current organization-scoped key to select a project target", async () => {
    const targetProject = { ...resolvedIdentity, id: "project-2" };
    const deps = dependencies();
    const projects = deps.projects;
    const findIdentity = vi.fn().mockResolvedValue(targetProject);
    projects.findIdentity = findIdentity;
    const service = createService(new MemoryApiKeys(), { ...deps, projects });
    const created = await service.create({
      name: "organization key",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }],
    });

    await expect(
      service.findResolvedToken({ token: created.token, projectId: targetProject.id }),
    ).resolves.toMatchObject({ type: "apiKey", project: { id: targetProject.id } });
    expect(findIdentity).toHaveBeenCalledWith(targetProject.id);
  });

  /**
   * The self-scoping half of token resolution: an ingestion key presents the
   * bearer token alone, so the bound project comes from the key's own
   * PROJECT-scoped binding.
   */
  it("derives the project from a key bound to exactly one, with no projectId supplied", async () => {
    const deps = dependencies();
    const service = createService(new MemoryApiKeys(), deps);
    const created = await service.create({
      name: "ingestion key",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "PROJECT", scopeId: resolvedIdentity.id, role: "ADMIN" }],
    });

    await expect(service.findResolvedToken({ token: created.token })).resolves.toMatchObject({
      type: "apiKey",
      project: { id: resolvedIdentity.id },
    });
  });

  /**
   * The other side of the same rule: two bindings name no single project, so
   * self-scoping would have to guess. It refuses instead, and the caller has
   * to say which project it means.
   */
  it("refuses to guess for a key bound to more than one project", async () => {
    const deps = dependencies();
    const service = createService(new MemoryApiKeys(), deps);
    const created = await service.create({
      name: "two-project key",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [
        { scopeType: "PROJECT", scopeId: resolvedIdentity.id, role: "ADMIN" },
        { scopeType: "PROJECT", scopeId: "project-2", role: "ADMIN" },
      ],
    });

    await expect(service.findResolvedToken({ token: created.token })).resolves.toBeNull();
  });

  it("upgrades a legacy SHA-256 hash after successful verification", async () => {
    const repository = new MemoryApiKeys();
    const service = createService(repository);
    const created = await service.create({
      name: "legacy",
      organizationId: "org-1",
      permissionMode: "default",
      bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }],
    });
    const secret = created.token.split("_")[1]!;
    repository.get(created.apiKey.id)!.hashedSecret = createHash("sha256")
      .update(secret)
      .digest("hex");

    await expect(service.findVerifiedToken({ token: created.token })).resolves.toMatchObject({
      id: created.apiKey.id,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.get(created.apiKey.id)!.hashedSecret).not.toBe(
      createHash("sha256").update(secret).digest("hex"),
    );
  });

  it("rotates the deprecated project credential through the project directory", async () => {
    const memory = new MemoryProjects();
    const service = createService(
      new MemoryApiKeys(),
      dependencies({ projects: projectPeer(memory) }),
    );

    const token = await service.regenerateLegacyProjectKey({
      projectId: "project-1",
    });
    expect(token).toMatch(/^sk-lw-[A-Za-z0-9]{48}$/);
    expect(memory.rotated).toEqual({
      projectId: "project-1",
      token,
    });
  });

  it("throws when the project credential cannot be rotated", async () => {
    const memory = new MemoryProjects();
    memory.legacyProjectRotationSucceeds = false;
    const service = createService(
      new MemoryApiKeys(),
      dependencies({ projects: projectPeer(memory) }),
    );

    await expect(
      service.regenerateLegacyProjectKey({ projectId: "missing" }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });

  it("defaults an unowned service key to organization ADMIN", async () => {
    const service = createService();
    const created = await service.create({
      name: "service",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [],
    });
    expect(created.apiKey.roleBindings).toEqual([
      {
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "ADMIN",
        customRoleId: null,
        id: "binding-1",
      },
    ]);
  });

  it("refuses the hidden system name to customer callers", async () => {
    const service = createService();
    await expect(
      service.create({
        name: "Langy session",
        organizationId: "org-1",
        permissionMode: "all",
        bindings: [],
      }),
    ).rejects.toMatchObject({ code: "api_key_reserved_name" });
  });

  it("allows the product mint to claim the hidden system name", async () => {
    const service = createService();
    await expect(
      service.create({
        name: "Langy session",
        isSystemManaged: true,
        organizationId: "org-1",
        permissionMode: "all",
        bindings: [],
      }),
    ).resolves.toMatchObject({ apiKey: { name: "Langy session" } });
  });

  it("keeps system-managed keys hidden from customer mutation paths", async () => {
    const service = createService();
    const created = await service.create({
      name: "Langy session",
      isSystemManaged: true,
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [],
    });
    await expect(
      service.update({
        id: created.apiKey.id,
        organizationId: "org-1",
        callerUserId: null,
        callerIsAdmin: true,
        name: "renamed",
      }),
    ).rejects.toMatchObject({ code: "api_key_not_found" });
    await expect(
      service.revoke({
        id: created.apiKey.id,
        organizationId: "org-1",
        callerUserId: null,
        callerIsAdmin: true,
      }),
    ).rejects.toMatchObject({ code: "api_key_not_found" });
  });

  it("validates the owner ceiling at the resolved project team scope", async () => {
    const can = vi.fn().mockResolvedValue(true);
    const authz = createApiFixture<AuthzApi>({
      listApiKeyBindings,
      can,
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    });
    const organizations = createApiFixture<OrganizationApi>({
      tryFindPersonalWorkspace: vi.fn().mockResolvedValue(null),
    });
    const projects = {
      getWithTeam: vi.fn().mockResolvedValue({
        archivedAt: null,
        team: { id: "team-1", organizationId: "org-1" },
      }),
      findPersonalWorkspaceOwner: vi.fn().mockResolvedValue(null),
    } as unknown as ProjectApi;
    const service = createService(
      new MemoryApiKeys(),
      dependencies({ authz, organizations, projects }),
    );
    await service.create({
      name: "project",
      userId: "user-1",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "PROJECT", scopeId: "project-1", role: "VIEWER" }],
    });
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          type: "project",
          id: "project-1",
          teamId: "team-1",
          organizationId: "org-1",
        },
      }),
    );
  });

  it("refuses a personal scope for a different owner or an unowned key", async () => {
    const memory = new MemoryProjects();
    memory.personalWorkspaceOwner = { ownerUserId: "owner-1" };
    const service = createService(
      new MemoryApiKeys(),
      dependencies({ projects: projectPeer(memory) }),
    );
    await expect(
      service.create({
        name: "service",
        organizationId: "org-1",
        permissionMode: "all",
        bindings: [{ scopeType: "TEAM", scopeId: "personal-team", role: "VIEWER" }],
      }),
    ).rejects.toMatchObject({ code: "api_key_scope_violation" });
  });

  /**
   * @scenario The owner of a personal workspace may bind their own key into it
   *
   * Ported from
   * `platform/app/src/app/api/api-keys/__tests__/api-keys-security.integration.test.ts`.
   * The refusal above is not a ban on personal scopes; it is a ban on granting
   * somebody else's. A key its owner holds is what the workspace is for, and
   * without this the guard could tighten into "no personal scopes at all" and
   * still look correct.
   */
  it("allows a personal scope for the owner the workspace belongs to", async () => {
    const memory = new MemoryProjects();
    memory.personalWorkspaceOwner = { ownerUserId: "owner-1" };
    const service = createService(
      new MemoryApiKeys(),
      dependencies({ projects: projectPeer(memory) }),
    );

    const created = await service.create({
      name: "owner-personal",
      userId: "owner-1",
      createdByUserId: "owner-1",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "PROJECT", scopeId: "personal-project", role: "ADMIN" }],
    });

    expect(created.apiKey.id).toBeDefined();
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
    const authz = createApiFixture<AuthzApi>({
      listApiKeyBindings,
      can: vi.fn().mockResolvedValue(false),
      canBatchByIds,
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    });
    const listActiveByScopes = vi.fn().mockResolvedValue({
      data: [resolvedProject, { ...resolvedProject, id: "project-2" }],
      hasMore: false,
    });
    const projects = {
      getWithTeam: vi.fn().mockResolvedValue(resolvedProject),
      listActiveByScopes,
      findPersonalWorkspaceOwner: vi.fn().mockResolvedValue(null),
    } as unknown as ProjectApi;
    const service = createService(repository, dependencies({ authz, projects }));
    const created = await service.create({
      name: "scoped",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "TEAM", scopeId: "team-1", role: "VIEWER" }],
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
    const listActiveByScopes = vi.fn();
    const projects = {
      listActiveByScopes,
      findPersonalWorkspaceOwner: vi.fn().mockResolvedValue(null),
    } as unknown as ProjectApi;
    const service = createService(repository, dependencies({ projects }));
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
    expect(listActiveByScopes).not.toHaveBeenCalled();
  });

  it("refuses to silently truncate a visibility decision", async () => {
    const repository = new MemoryApiKeys();
    const authz = createApiFixture<AuthzApi>({
      listApiKeyBindings,
      can: vi.fn().mockResolvedValue(false),
      hasPermission: vi.fn().mockResolvedValue(true),
      listUserCreatedRoles: vi.fn().mockResolvedValue([]),
    });
    const projects = {
      getWithTeam: vi.fn().mockResolvedValue(resolvedProject),
      listActiveByScopes: vi.fn().mockResolvedValue({ data: [], hasMore: true }),
      findPersonalWorkspaceOwner: vi.fn().mockResolvedValue(null),
    } as unknown as ProjectApi;
    const service = createService(repository, dependencies({ authz, projects }));
    const created = await service.create({
      name: "too-wide",
      organizationId: "org-1",
      permissionMode: "all",
      bindings: [{ scopeType: "TEAM", scopeId: "team-1", role: "VIEWER" }],
    });

    await expect(
      service.resolveVisibleProjects({
        apiKeyId: created.apiKey.id,
        organizationId: "org-1",
      }),
    ).rejects.toMatchObject({ code: "project_visibility_too_wide" });
  });
});

describe("API key verification", () => {
  describe("when a legacy key verifies", () => {
    /** @scenario "A legacy service key states its access the first time it is used" */
    it("mints its grant on the resolution path", async () => {
      const mint = vi.fn();
      const legacyGrants = { mint } as unknown as ApiKeyDependencies["legacyGrants"];
      const service = createService(new MemoryApiKeys(), dependencies({ legacyGrants }));
      const created = await service.create({
        name: "legacy",
        organizationId: "org-1",
        permissionMode: "default",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }],
      });

      const verified = await service.findVerifiedToken({ token: created.token });

      expect(verified?.id).toBe(created.apiKey.id);
      expect(mint).toHaveBeenCalledWith(expect.objectContaining({ id: created.apiKey.id }));
    });
  });

  describe("when the credential does not resolve", () => {
    it("mints nothing", async () => {
      const mint = vi.fn();
      const legacyGrants = { mint } as unknown as ApiKeyDependencies["legacyGrants"];
      const service = createService(new MemoryApiKeys(), dependencies({ legacyGrants }));

      expect(await service.findVerifiedToken({ token: "sk-lw-x_y" })).toBeNull();
      expect(mint).not.toHaveBeenCalled();
    });
  });

  describe("when a revoked key is presented", () => {
    it("mints nothing", async () => {
      const mint = vi.fn();
      const legacyGrants = { mint } as unknown as ApiKeyDependencies["legacyGrants"];
      const service = createService(new MemoryApiKeys(), dependencies({ legacyGrants }));
      const created = await service.create({
        name: "revoked",
        organizationId: "org-1",
        permissionMode: "default",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }],
      });
      await service.revoke({
        id: created.apiKey.id,
        organizationId: "org-1",
        callerUserId: null,
        callerIsAdmin: true,
      });

      expect(await service.findVerifiedToken({ token: created.token })).toBeNull();
      expect(mint).not.toHaveBeenCalled();
    });
  });
});

describe("API keys on a credential's behalf", () => {
  async function serviceWithOneServiceKey(canManage: boolean) {
    const hasApiKeyPermission = vi.fn().mockResolvedValue(canManage);
    const service = createService(
      new MemoryApiKeys(),
      dependencies({
        authz: createApiFixture<AuthzApi>({
          listApiKeyBindings,
          hasApiKeyPermission,
          can: vi.fn().mockResolvedValue(true),
          hasPermission: vi.fn().mockResolvedValue(true),
        }),
      }),
    );
    const created = await service.create({
      name: "service key",
      organizationId: "org-1",
      permissionMode: "default",
      bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org-1" }],
    });

    return { service, hasApiKeyPermission, key: created.apiKey };
  }

  describe("when a member credential lists", () => {
    it("lists that member's own keys without asking about organization:manage", async () => {
      const { service, hasApiKeyPermission } = await serviceWithOneServiceKey(true);

      const listed = await service.listForCaller({
        apiKeyId: "credential-1",
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(listed).toEqual(await service.list({ userId: "user-1", organizationId: "org-1" }));
      expect(hasApiKeyPermission).not.toHaveBeenCalled();
    });
  });

  describe("when a service credential lists", () => {
    it("lists every key in the organization when it holds organization:manage", async () => {
      const { service, hasApiKeyPermission, key } = await serviceWithOneServiceKey(true);

      const listed = await service.listForCaller({
        apiKeyId: "credential-1",
        userId: null,
        organizationId: "org-1",
      });

      expect(listed.map((row) => row.id)).toEqual([key.id]);
      expect(hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "credential-1",
        userId: null,
        organizationId: "org-1",
        scope: { type: "org", id: "org-1" },
        permission: "organization:manage",
      });
    });

    it("refuses the organization-wide listing without organization:manage", async () => {
      const { service } = await serviceWithOneServiceKey(false);

      await expect(
        service.listForCaller({ apiKeyId: "credential-1", userId: null, organizationId: "org-1" }),
      ).rejects.toMatchObject({ code: "api_key_permission_denied" });
    });
  });

  describe("when a member edits a key that is not theirs", () => {
    it("answers not found, where a plain update answers not owned", async () => {
      const { service, key } = await serviceWithOneServiceKey(true);
      const foreignEdit = {
        id: key.id,
        organizationId: "org-1",
        callerUserId: "user-2",
        callerIsAdmin: false,
        name: "renamed",
      };

      await expect(service.update(foreignEdit)).rejects.toMatchObject({
        code: "api_key_not_owned",
      });
      await expect(service.updateAsCaller(foreignEdit)).rejects.toMatchObject({
        code: "api_key_not_found",
      });
    });
  });
});
