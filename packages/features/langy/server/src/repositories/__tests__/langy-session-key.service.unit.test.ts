import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import {
  LANGY_CANDIDATE_PERMISSIONS,
  LangySessionKeyMetricsPort,
  LangySessionKeyService,
} from "@langwatch/langy-server";
import { describe, expect, it, vi } from "vitest";
import {
  LangySessionKeyRepository,
  type LangySessionKeyRecord,
} from "../langy-session-key.repository";

class SessionKeyRepository extends LangySessionKeyRepository {
  key: LangySessionKeyRecord | null = null;
  reapedCount = 0;
  readonly revocations: Array<{ apiKeyId: string; revokedAt: Date }> = [];
  readonly reaperCalls: Array<{ revokedAt: Date; name: string }> = [];

  async tryFindProjectScope() {
    return { teamId: "team-1", organizationId: "organization-1" };
  }

  async tryFindById(): Promise<LangySessionKeyRecord | null> {
    return this.key;
  }

  async revoke(apiKeyId: string, revokedAt: Date): Promise<void> {
    this.revocations.push({ apiKeyId, revokedAt });
  }

  async reapExpired(revokedAt: Date, name: string): Promise<number> {
    this.reaperCalls.push({ revokedAt, name });
    return this.reapedCount;
  }
}

class SessionKeyMetrics extends LangySessionKeyMetricsPort {
  readonly record = vi.fn();
}

function createService(input: {
  repository: SessionKeyRepository;
  apiKeys: ApiKeyService;
  authz: AuthzService;
  metrics: SessionKeyMetrics;
}): LangySessionKeyService {
  return LangySessionKeyService.create(input);
}

describe("LangySessionKeyService", () => {
  it("mints only the holder's Langy permissions at the project scope", async () => {
    const repository = new SessionKeyRepository();
    const apiKeyCreate: ApiKeyService["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const permissions: Awaited<ReturnType<AuthzService["effectivePermissions"]>> = [
      "project:view",
      "prompts:update",
    ];
    const apiKeys: ApiKeyService = Object.create(ApiKeyService.prototype);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzService = Object.create(AuthzService.prototype);
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
    const apiKeyCreate: ApiKeyService["create"] = vi.fn(async () => {
      const apiKey = Object.assign(Object.create(null), { id: "key-1" });
      return { token: "session-token", apiKey };
    });
    const apiKeys: ApiKeyService = Object.create(ApiKeyService.prototype);
    apiKeys.create = apiKeyCreate;
    const authz: AuthzService = Object.create(AuthzService.prototype);
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
      apiKeys: Object.create(ApiKeyService.prototype),
      authz: Object.create(AuthzService.prototype),
      metrics,
    });

    await expect(
      service.revokeManaged({ apiKeyId: "key-1", projectId: "project-1" }),
    ).resolves.toBe("refused");
    await expect(service.reapExpired(new Date("2026-08-26T00:00:00Z"))).resolves.toBe(2);
    expect(repository.reaperCalls).toEqual([
      {
        revokedAt: new Date("2026-08-26T00:00:00Z"),
        name: expect.any(String),
      },
    ]);
    expect(metrics.record).toHaveBeenCalledWith({ operation: "reaped", count: 2 });
    expect(LANGY_CANDIDATE_PERMISSIONS).toContain("project:view");
  });
});
