/**
 * The write gates the settings page is bounded by: who may write a scope, what
 * a plan may persist, and who may switch retention off entirely.
 *
 * The read side advertises a scope as writable using exactly the permissions
 * asserted here, so the pair is what stops the chip picker offering a scope the
 * save then rejects.
 */
import { describe, expect, it, vi } from "vitest";
import { DataRetentionAdministratorPort } from "../../ports/data-retention-administrator.port";
import {
  DataRetentionDirectoryPort,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
} from "../../ports/data-retention-directory.port";
import { DataRetentionPermissionsPort } from "../../ports/data-retention-permissions.port";
import { DataRetentionPlanPort, type DataRetentionPlan } from "../../ports/data-retention-plan.port";
import {
  DataRetentionPolicyService,
  assertPlanAllowsRetentionValue,
  requiredRetentionWritePermission,
} from "../data-retention-policy.service";

const ACTOR = { userId: "user_alice", email: "alice@example.com" };

class StubDirectory extends DataRetentionDirectoryPort {
  constructor(private readonly organizationId: string | null) {
    super();
  }
  async tryGetProjectLineage(): Promise<RetentionProjectLineage | null> {
    return {
      projectId: "proj_a",
      name: "A",
      teamId: "team_1",
      organizationId: this.organizationId,
      organizationName: "Acme",
    };
  }
  async listOrganizationDirectory(): Promise<RetentionOrganizationDirectory> {
    return { teams: [], projects: [] };
  }
  async tryResolveScopeOrganizationId(): Promise<string | null> {
    return this.organizationId;
  }
  async listScopeProjects(): Promise<ReadonlyArray<{ id: string; teamId: string }>> {
    return [];
  }
}

class StubPermissions extends DataRetentionPermissionsPort {
  constructor(private readonly allow: boolean) {
    super();
  }
  async canManageOrganization(): Promise<boolean> {
    return this.allow;
  }
  async canManageTeams(input: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return new Map(input.teamIds.map((id) => [id, this.allow] as const));
  }
  async canUpdateProjects(input: {
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return new Map(input.projectIds.map((id) => [id, this.allow] as const));
  }
  async canViewTraces(): Promise<ReadonlyMap<string, boolean>> {
    return new Map();
  }
}

class StubPlans extends DataRetentionPlanPort {
  constructor(private readonly plan: DataRetentionPlan) {
    super();
  }
  async getPlan(): Promise<DataRetentionPlan> {
    return this.plan;
  }
}

class StubAdministrators extends DataRetentionAdministratorPort {
  constructor(private readonly admin: boolean) {
    super();
  }
  isPlatformAdministrator(): boolean {
    return this.admin;
  }
}

function policy(options: {
  organizationId?: string | null;
  allow?: boolean;
  plan?: DataRetentionPlan;
  admin?: boolean;
}) {
  return DataRetentionPolicyService.create({
    directory: new StubDirectory(
      "organizationId" in options ? options.organizationId ?? null : "org_1",
    ),
    permissions: new StubPermissions(options.allow ?? true),
    plans: new StubPlans(options.plan ?? { free: false, uncapped: false }),
    administrators: new StubAdministrators(options.admin ?? false),
  });
}

describe("given the permission a scope write demands", () => {
  it("asks a project for project:update rather than project:manage", () => {
    expect(requiredRetentionWritePermission("PROJECT")).toBe("project:update");
    expect(requiredRetentionWritePermission("TEAM")).toBe("team:manage");
    expect(requiredRetentionWritePermission("ORGANIZATION")).toBe("organization:manage");
  });
});

describe("given a caller writing a retention override", () => {
  describe("when they hold the scope's permission", () => {
    it("allows the write", async () => {
      await expect(
        policy({}).assertCanWriteScope({
          actor: ACTOR,
          scope: { scopeType: "TEAM", scopeId: "team_1" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when they do not", () => {
    it("refuses, naming the permission the scope needs", async () => {
      await expect(
        policy({ allow: false }).assertCanWriteScope({
          actor: ACTOR,
          scope: { scopeType: "TEAM", scopeId: "team_1" },
        }),
      ).rejects.toThrow(/team:manage/);
    });
  });
});

describe("given a plan-gated write", () => {
  describe("when the scope does not resolve to an organization", () => {
    /** @scenario "Reject a missing write target" */
    it("refuses the write rather than gating on the caller's project", async () => {
      await expect(
        policy({ organizationId: null }).assertWriteAllowed({
          actor: ACTOR,
          scope: { scopeType: "TEAM", scopeId: "team_elsewhere" },
          retentionDays: 63,
        }),
      ).rejects.toThrow(/was not found/);
    });
  });

  describe("when the organization is on a free plan", () => {
    it("refuses", async () => {
      await expect(
        policy({ plan: { free: true, uncapped: false } }).assertPlanForProject({
          actor: ACTOR,
          projectId: "proj_a",
        }),
      ).rejects.toThrow(/paid-plan feature/);
    });
  });
});

describe("given a value a plan may or may not persist", () => {
  it("allows only the fixed presets on a capped plan", () => {
    const capped = { free: false, uncapped: false };
    expect(() => assertPlanAllowsRetentionValue(capped, 35)).not.toThrow();
    expect(() => assertPlanAllowsRetentionValue(capped, 63)).not.toThrow();
    expect(() => assertPlanAllowsRetentionValue(capped, 98)).toThrow(/isn't available on your plan/);
  });

  it("allows any whole-week value at or above the floor on an uncapped plan", () => {
    const uncapped = { free: false, uncapped: true };
    expect(() => assertPlanAllowsRetentionValue(uncapped, 49)).not.toThrow();
    expect(() => assertPlanAllowsRetentionValue(uncapped, 700)).not.toThrow();
    // The paid short presets stay the sole exceptions below the floor.
    expect(() => assertPlanAllowsRetentionValue(uncapped, 35)).not.toThrow();
    expect(() => assertPlanAllowsRetentionValue(uncapped, 42)).toThrow(/at least 49 days/);
  });

  it("leaves the indefinite sentinel to the platform-administrator gate", () => {
    expect(() => assertPlanAllowsRetentionValue({ free: false, uncapped: false }, 0)).not.toThrow();
  });
});

describe("given a request to disable retention entirely", () => {
  describe("when the caller is not a platform administrator", () => {
    it("refuses", () => {
      expect(() => policy({ admin: false }).assertCanDisableRetention({ actor: ACTOR })).toThrow(
        /platform administrators/,
      );
    });
  });

  describe("when the caller is one", () => {
    it("allows it", () => {
      expect(() =>
        policy({ admin: true }).assertCanDisableRetention({ actor: ACTOR }),
      ).not.toThrow();
    });
  });
});

describe("given the read side's configurable flag", () => {
  it("reports false for a project with no organization", async () => {
    await expect(
      policy({}).canConfigureRetention({ organizationId: null, actor: ACTOR }),
    ).resolves.toBe(false);
  });

  it("reports false on a free plan and true otherwise", async () => {
    await expect(
      policy({ plan: { free: true, uncapped: false } }).canConfigureRetention({
        organizationId: "org_1",
        actor: ACTOR,
      }),
    ).resolves.toBe(false);
    await expect(
      policy({}).canConfigureRetention({ organizationId: "org_1", actor: ACTOR }),
    ).resolves.toBe(true);
  });
});
