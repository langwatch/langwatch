import { ApiKeyNotFoundError, type ApiKeyApi } from "@langwatch/api-key-contract";
import { ALL_PERMISSIONS } from "@langwatch/authorization";
import {
  type AuthzApi,
  type AuthzEffectivePermissionsInput,
  type AuthzEffectivePermissionsOutput,
  AuthzEngine,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import { LangySessionKeyScopeError } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { LangySessionKeyMetrics } from "../../features/session-key/services/langy-session-key.service.ts";
import {
  LANGY_CANDIDATE_PERMISSIONS,
  LANGY_UNATTENDED_PERMISSIONS,
  LangySessionKeyService,
} from "../../features/session-key/services/langy-session-key.service.ts";
import {
  LangySessionKeyRepository,
  type LangySessionKeyRecord,
} from "../langy-session-key.repository.ts";

class SessionKeyRepository extends LangySessionKeyRepository {
  key: LangySessionKeyRecord | null = null;
  readonly revocations: { apiKeyId: string; revokedAt: Instant }[] = [];

  async getProjectScope() {
    return { teamId: "team-1", organizationId: "organization-1" };
  }

  async getById(input: { apiKeyId: string }): Promise<LangySessionKeyRecord> {
    if (!this.key) throw new ApiKeyNotFoundError(input.apiKeyId);
    return this.key;
  }

  async revoke(apiKeyId: string, revokedAt: Instant): Promise<void> {
    this.revocations.push({ apiKeyId, revokedAt });
  }
}

class SessionKeyMetrics implements LangySessionKeyMetrics {
  readonly record = vi.fn();
}

function createService(input: {
  repository: SessionKeyRepository;
  apiKeys: ApiKeyApi;
  authz: AuthzApi;
  metrics: SessionKeyMetrics;
}): LangySessionKeyService {
  return LangySessionKeyService.create(input);
}

describe("LangySessionKeyService", () => {
  /** @scenario "The Langy key is scoped to only its own project" */
  it("mints only the holder's Langy permissions at the project scope", async () => {
    const repository = new SessionKeyRepository();
    const apiKeyCreate: ApiKeyApi["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const permissions: Awaited<ReturnType<AuthzApi["effectivePermissions"]>> = [
      "project:view",
      "prompts:update",
    ];
    const apiKeys: ApiKeyApi = Object.create(null);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzApi = createApiFixture<AuthzApi>();
    const effectivePermissions: AuthzApi["effectivePermissions"] = vi.fn(async () => permissions);
    authz.effectivePermissions = effectivePermissions;
    const metrics = new SessionKeyMetrics();

    const result = await createService({ repository, apiKeys, authz, metrics }).mint({
      session: { user: { id: "user-1" } },
      projectId: "project-1",
      organizationId: "organization-1",
    });

    expect(result).toEqual({ token: "session-token", apiKeyId: "key-1" });
    expect(effectivePermissions).toHaveBeenCalledWith({
      principal: { type: "user", id: "user-1" },
      scope: {
        type: "project",
        id: "project-1",
        teamId: "team-1",
        organizationId: "organization-1",
      },
    });
    expect(apiKeyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        permissions,
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project-1" }],
      }),
    );
    expect(metrics.record).toHaveBeenCalledWith({ operation: "minted" });
  });

  // The widening #7389 shipped, pinned where it actually lands: on the key.
  // The candidate list is a CEILING, so a holder who holds everything Langy
  // may ask for is the only caller whose minted key shows the ceiling's full
  // shape — and that shape is the owner's 2026-08-21 rule, which the coverage
  // guard states over the const and this states over the mint.
  it("carries the full tenant-data write surface onto a key whose holder holds it", async () => {
    const repository = new SessionKeyRepository();
    const apiKeyCreate: ApiKeyApi["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const apiKeys: ApiKeyApi = Object.create(null);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzApi = createApiFixture<AuthzApi>();
    authz.effectivePermissions = vi.fn(async () => [...LANGY_CANDIDATE_PERMISSIONS]);

    await createService({
      repository,
      apiKeys,
      authz,
      metrics: new SessionKeyMetrics(),
    }).mint({
      session: { user: { id: "user-1" } },
      projectId: "project-1",
      organizationId: "organization-1",
    });

    const granted = (apiKeyCreate as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .permissions as string[];

    // Full CRUD on tenant data, including the grains the pre-#7389 list
    // withheld. The user's own permissions remain the ceiling; this is the
    // ceiling itself.
    for (const permission of [
      "scenarios:manage",
      "datasets:delete",
      "traces:manage",
      "triggers:manage",
      "experiments:manage",
      "gatewayBudgets:manage",
      "virtualKeys:create",
    ]) {
      expect(granted, permission).toContain(permission);
    }

    // The lines that remain. `project` is reached only to READ, because its
    // writes are the credential surface; `langy` and `ops` are absent at every
    // grain, because neither is tenant data.
    expect(granted.filter((p) => p.startsWith("project:"))).toEqual(["project:view"]);
    expect(granted.filter((p) => p.startsWith("langy:") || p.startsWith("ops:"))).toEqual([]);
  });

  // Ported from langySessionKey.integration.test.ts; adapted from real-DB to fake-authz harness.
  // Permission intersects caller's role with candidate ceiling; no DB round trip needed.
  /** @scenario Langy can delete my work, because I can */
  it("mints a key carrying a destructive grain the caller holds", async () => {
    const repository = new SessionKeyRepository();
    const apiKeyCreate: ApiKeyApi["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const apiKeys: ApiKeyApi = Object.create(null);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzApi = createApiFixture<AuthzApi>();
    authz.effectivePermissions = vi
      .fn<(args: AuthzEffectivePermissionsInput) => Promise<AuthzEffectivePermissionsOutput>>()
      .mockImplementation(async () => ["project:view", "experiments:delete"]);

    await createService({
      repository,
      apiKeys,
      authz,
      metrics: new SessionKeyMetrics(),
    }).mint({
      session: { user: { id: "user-1" } },
      projectId: "project-1",
      organizationId: "organization-1",
    });

    const granted = (apiKeyCreate as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .permissions as string[];
    expect(granted).toContain("experiments:delete");
  });

  /** @scenario Langy cannot delete my work when I cannot */
  it("withholds a destructive grain the caller does not hold, even though Langy could ask for it", async () => {
    const repository = new SessionKeyRepository();
    const apiKeyCreate: ApiKeyApi["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const apiKeys: ApiKeyApi = Object.create(null);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzApi = createApiFixture<AuthzApi>();
    // Holds enough to mint a key at all (view), but not the destructive grain.
    authz.effectivePermissions = vi
      .fn<(args: AuthzEffectivePermissionsInput) => Promise<AuthzEffectivePermissionsOutput>>()
      .mockImplementation(async () => ["project:view", "experiments:view"]);

    await createService({
      repository,
      apiKeys,
      authz,
      metrics: new SessionKeyMetrics(),
    }).mint({
      session: { user: { id: "user-1" } },
      projectId: "project-1",
      organizationId: "organization-1",
    });

    const granted = (apiKeyCreate as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .permissions as string[];
    // The ceiling names this grain (proven above), but the caller's own role
    // does not hold it, so the intersection Langy mints must not either.
    expect(LANGY_CANDIDATE_PERMISSIONS).toContain("experiments:delete");
    expect(granted).not.toContain("experiments:delete");
  });

  describe("given the permissions the person holds in the project", () => {
    const holding = (held: AuthzEffectivePermissionsOutput) => {
      const apiKeyCreate: ApiKeyApi["create"] = vi.fn(async () => {
        const apiKey = Object.assign(Object.create(null), { id: "key-1" });
        return { token: "session-token", apiKey };
      });
      const apiKeys: ApiKeyApi = Object.create(null);
      apiKeys.create = apiKeyCreate;
      const authz: AuthzApi = createApiFixture<AuthzApi>();
      authz.effectivePermissions = vi.fn(async () => held);
      const service = createService({
        repository: new SessionKeyRepository(),
        apiKeys,
        authz,
        metrics: new SessionKeyMetrics(),
      });
      const mint = () =>
        service.mint({
          session: { user: { id: "user-1" } },
          projectId: "project-1",
          organizationId: "organization-1",
        });

      return {
        mint,
        granted: async () => {
          await mint();
          return (apiKeyCreate as ReturnType<typeof vi.fn>).mock.calls[0]![0]
            .permissions as string[];
        },
      };
    };

    /** @scenario "Creating asks for permission to create" */
    it("grants create to a holder who can create but not delete", async () => {
      const granted = await holding(["project:view", "scenarios:create"]).granted();

      expect(granted).toContain("scenarios:create");
      expect(granted).not.toContain("scenarios:delete");
    });

    /** @scenario "Being able to manage still lets you create" */
    it("grants manage to a holder who can manage", async () => {
      const granted = await holding(["project:view", "scenarios:manage"]).granted();

      expect(granted).toContain("scenarios:manage");
    });

    /** @scenario "Langy can do what the person asking can do" */
    it("grants create to a holder who can create and manage", async () => {
      const granted = await holding([
        "project:view",
        "scenarios:create",
        "scenarios:manage",
      ]).granted();

      expect(granted).toEqual(expect.arrayContaining(["scenarios:create", "scenarios:manage"]));
    });

    /** @scenario "Langy cannot do what the person asking cannot do" */
    it("grants read and no create to a holder who can only view", async () => {
      const granted = await holding(["project:view", "scenarios:view"]).granted();

      expect(granted).toContain("scenarios:view");
      expect(granted).not.toContain("scenarios:create");
      expect(granted).not.toContain("scenarios:manage");
    });

    /** @scenario "Langy is never granted access outside its own remit" */
    it("leaves out organization administration, stored secrets and public sharing for an admin", async () => {
      const outsideRemit = [
        "organization:manage",
        "organization:delete",
        "team:manage",
        "project:manage",
        "secrets:manage",
        "secrets:view",
        "traces:share",
      ] as const;
      const granted = await holding([...LANGY_CANDIDATE_PERMISSIONS, ...outsideRemit]).granted();

      for (const permission of outsideRemit) {
        expect(granted, permission).not.toContain(permission);
      }
    });

    /** @scenario "A person with no relevant access gets no key at all" */
    it("mints no key for a holder of none of the permissions Langy uses", async () => {
      const { mint } = holding(["organization:view"]);

      await expect(mint()).rejects.toBeInstanceOf(LangySessionKeyScopeError);
    });
  });

  describe("given a key minted for a turn nobody is watching", () => {
    const PROJECT_SCOPE: AuthzScopeRef = {
      type: "project",
      id: "project-1",
      teamId: "team-1",
      organizationId: "organization-1",
    };

    /** A member's grants as the authz module collects them; `role: null` is a removed member. */
    const memberGrants = (role: "viewer" | "admin" | null): CollectedGrants => ({
      principal: { type: "user", id: "user-1" },
      organizationId: "organization-1",
      organizationRole: role ? "MEMBER" : null,
      isOrgMember: role !== null,
      membershipDisabled: false,
      bindings: role ? [{ roleKey: role, scopeType: "PROJECT", scopeId: "project-1" }] : [],
      customRolePermissions: new Map(),
    });

    /** The real decision engine over grants the test changes, as the authz module answers. */
    const mintingAs = (member: { grants: CollectedGrants }) => {
      const engine = new AuthzEngine();
      const granted: string[][] = [];
      const apiKeys: ApiKeyApi = Object.create(null);
      apiKeys.create = async (input) => {
        granted.push([...(input.permissions ?? [])]);
        return { token: "session-token", apiKey: Object.assign(Object.create(null), { id: "k" }) };
      };
      const authz: AuthzApi = createApiFixture<AuthzApi>();
      authz.effectivePermissions = async ({ scope }) =>
        ALL_PERMISSIONS.filter(
          (permission) => engine.decide({ grants: member.grants, permission, scope }).allowed,
        );
      const service = createService({
        repository: new SessionKeyRepository(),
        apiKeys,
        authz,
        metrics: new SessionKeyMetrics(),
      });
      const mint = (ceiling?: "full" | "unattended") =>
        service.mint({
          session: { user: { id: "user-1" } },
          projectId: "project-1",
          organizationId: "organization-1",
          ...(ceiling ? { ceiling } : {}),
        });
      return { engine, granted, mint };
    };

    /** @scenario "An unattended key never carries more than the person holds" */
    it("holds what the person may view and nothing they do not hold", async () => {
      const repository = new SessionKeyRepository();
      const granted: string[][] = [];
      const apiKeys: ApiKeyApi = Object.create(null);
      apiKeys.create = async (input) => {
        granted.push([...(input.permissions ?? [])]);
        return { token: "session-token", apiKey: Object.assign(Object.create(null), { id: "k" }) };
      };
      const authz: AuthzApi = createApiFixture<AuthzApi>();
      authz.effectivePermissions = async () => ["project:view", "traces:view", "traces:update"];

      await createService({ repository, apiKeys, authz, metrics: new SessionKeyMetrics() }).mint({
        session: { user: { id: "user-1" } },
        projectId: "project-1",
        organizationId: "organization-1",
        ceiling: "unattended",
      });

      expect(LANGY_UNATTENDED_PERMISSIONS).toContain("cost:view");
      expect(granted).toEqual([["traces:view"]]);
    });

    /** @scenario "An unattended key holds only what reading a board needs" */
    it("holds the allowlist for a person who holds everything, and no other view", async () => {
      const { granted, mint } = mintingAs({ grants: memberGrants("admin") });

      await mint();
      await mint("unattended");

      const [chat, unattended] = granted;
      expect(unattended).toEqual([...LANGY_UNATTENDED_PERMISSIONS]);
      expect(unattended).toEqual(
        expect.arrayContaining(["analytics:view", "traces:view", "cost:view"]),
      );
      // What the same person's chat key reads and a run's key does not.
      for (const outside of ["project:view", "team:view", "datasets:view", "triggers:view"]) {
        expect(chat).toContain(outside);
        expect(unattended).not.toContain(outside);
      }
      expect(unattended!.some((permission) => permission.startsWith("auditLog:"))).toBe(false);
      expect(unattended!.some((permission) => permission.startsWith("secrets:"))).toBe(false);
    });

    it("keeps the same person's chat key at the full ceiling", async () => {
      const { granted, mint } = mintingAs({ grants: memberGrants("admin") });

      await mint();
      await mint("unattended");

      const [chat, unattended] = granted;
      expect(chat).toContain("prompts:update");
      expect(unattended).not.toContain("prompts:update");
      expect(unattended!.every((permission) => permission.endsWith(":view"))).toBe(true);
      expect(unattended!.length).toBeGreaterThan(0);
    });

    /** @scenario "A member whose role was removed gets no unattended key" */
    it("mints view permissions for a viewer, then nothing once their role is removed", async () => {
      const member = { grants: memberGrants("viewer") };
      const { engine, granted, mint } = mintingAs(member);

      await mint("unattended");
      const minted = granted[0]!;
      expect(minted).toContain("traces:view");
      expect(minted.every((permission) => permission.endsWith(":view"))).toBe(true);

      member.grants = memberGrants(null);

      await expect(mint("unattended")).rejects.toBeInstanceOf(LangySessionKeyScopeError);
      expect(granted).toHaveLength(1);
      // The key minted before the removal is capped by its owner as they are now.
      const earlierKey: CollectedGrants = {
        principal: { type: "apiKey", id: "k" },
        organizationId: "organization-1",
        organizationRole: null,
        isOrgMember: false,
        membershipDisabled: false,
        bindings: [{ roleKey: "custom:k", scopeType: "PROJECT", scopeId: "project-1" }],
        customRolePermissions: new Map([["k", minted]]),
      };
      expect(
        engine.decide({ grants: earlierKey, permission: "traces:view", scope: PROJECT_SCOPE })
          .allowed,
      ).toBe(true);
      expect(
        engine.decideWithCeiling({
          keyGrants: earlierKey,
          ownerGrants: member.grants,
          permission: "traces:view",
          scope: PROJECT_SCOPE,
        }),
      ).toMatchObject({ allowed: false, denialReason: "owner-ceiling" });
    });
  });

  it("refuses a non-Langy key", async () => {
    const repository = new SessionKeyRepository();
    repository.key = {
      id: "key-1",
      name: "customer key",
      revokedAt: null,
      isScopedToProject: true,
    };
    const metrics = new SessionKeyMetrics();
    const service = createService({
      repository,
      apiKeys: Object.create(null),
      authz: createApiFixture<AuthzApi>(),
      metrics,
    });

    await expect(
      service.revokeManaged({ apiKeyId: "key-1", projectId: "project-1" }),
    ).resolves.toBe("refused");
    expect(LANGY_CANDIDATE_PERMISSIONS).toContain("project:view");
  });
});
