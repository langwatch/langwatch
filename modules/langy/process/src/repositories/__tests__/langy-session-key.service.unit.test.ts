import { createApiFixture } from "@langwatch/api-fixture";
import { ApiKeyNotFoundError, type ApiKeyApi } from "@langwatch/api-key-contract";
import {
  type AuthzService,
  type AuthzEffectivePermissionsInput,
  type AuthzEffectivePermissionsOutput,
} from "@langwatch/authz-contract";
import { type LangySessionKeyMetrics } from "@langwatch/langy-process";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  LANGY_CANDIDATE_PERMISSIONS,
  LangySessionKeyService,
} from "../../services/langy-session-key.service.ts";
import {
  LangySessionKeyRepository,
  type LangySessionKeyRecord,
} from "../langy-session-key.repository.ts";

class SessionKeyRepository extends LangySessionKeyRepository {
  key: LangySessionKeyRecord | null = null;
  reapedCount = 0;
  readonly revocations: { apiKeyId: string; revokedAt: Instant }[] = [];
  readonly reaperCalls: { revokedAt: Instant; name: string }[] = [];

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

  async revokeExpiredByName(input: { name: string; now: Instant }): Promise<number> {
    this.reaperCalls.push({ revokedAt: input.now, name: input.name });
    return this.reapedCount;
  }
}

class SessionKeyMetrics implements LangySessionKeyMetrics {
  readonly record = vi.fn();
}

function createService(input: {
  repository: SessionKeyRepository;
  apiKeys: ApiKeyApi;
  authz: AuthzService;
  metrics: SessionKeyMetrics;
}): LangySessionKeyService {
  return LangySessionKeyService.create(input);
}

describe("LangySessionKeyService", () => {
  it("mints only the holder's Langy permissions at the project scope", async () => {
    const repository = new SessionKeyRepository();
    const apiKeyCreate: ApiKeyApi["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const permissions: Awaited<ReturnType<AuthzService["effectivePermissions"]>> = [
      "project:view",
      "prompts:update",
    ];
    const apiKeys: ApiKeyApi = Object.create(null);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzService = createApiFixture<AuthzService>();
    const effectivePermissions: AuthzService["effectivePermissions"] = vi.fn(
      async () => permissions,
    );
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
    const authz: AuthzService = createApiFixture<AuthzService>();
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
    const authz: AuthzService = createApiFixture<AuthzService>();
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
    const authz: AuthzService = createApiFixture<AuthzService>();
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

  it("refuses a non-Langy key and reaps only expired session keys", async () => {
    const repository = new SessionKeyRepository();
    repository.key = {
      id: "key-1",
      name: "customer key",
      revokedAt: null,
      isScopedToProject: true,
    };
    repository.reapedCount = 2;
    const metrics = new SessionKeyMetrics();
    const service = createService({
      repository,
      apiKeys: Object.create(null),
      authz: createApiFixture<AuthzService>(),
      metrics,
    });

    await expect(
      service.revokeManaged({ apiKeyId: "key-1", projectId: "project-1" }),
    ).resolves.toBe("refused");
    await expect(service.reapExpired(Temporal.Instant.from("2026-08-26T00:00:00Z"))).resolves.toBe(
      2,
    );
    expect(repository.reaperCalls).toEqual([
      {
        revokedAt: Temporal.Instant.from("2026-08-26T00:00:00Z"),
        name: expect.any(String),
      },
    ]);
    expect(metrics.record).toHaveBeenCalledWith({ operation: "reaped", count: 2 });
    expect(LANGY_CANDIDATE_PERMISSIONS).toContain("project:view");
  });
});
