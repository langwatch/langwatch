/**
 * The write gates the settings page is bounded by: who may write a scope, what a plan may
 * persist, and who may switch retention off entirely.
 */
import { describe, expect, it } from "vitest";
import {
  DataRetentionDirectoryRepository,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
} from "../../repositories/data-retention-directory.repository.ts";
import {
  DataRetentionPlanPort,
  type DataRetentionPlan,
} from "../../ports/data-retention-plan.port.ts";
import { createDataRetentionTestAuthz } from "../../app/__tests__/data-retention.fixture.ts";
import { DataRetentionPolicyService } from "../data-retention-policy.service.ts";
import { RetentionPermissionsService } from "../retention-permissions.service.ts";

const ACTOR = { userId: "user_alice", email: "alice@example.com" };

class StubDirectory extends DataRetentionDirectoryRepository {
  constructor(private readonly organizationId: string | null) {
    super();
  }
  async findProjectLineage(): Promise<RetentionProjectLineage | null> {
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
  async findScopeOrganizationId(): Promise<string | null> {
    return this.organizationId;
  }
  async listScopeProjects(): Promise<ReadonlyArray<{ id: string; teamId: string }>> {
    return [];
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

function policy(options: {
  organizationId?: string | null;
  allow?: boolean;
  plan?: DataRetentionPlan;
  admin?: boolean;
}) {
  return DataRetentionPolicyService.create({
    directory: new StubDirectory(
      "organizationId" in options ? (options.organizationId ?? null) : "org_1",
    ),
    permissions: RetentionPermissionsService.create({
      authz: createDataRetentionTestAuthz(options.allow ?? true),
    }),
    plans: new StubPlans(options.plan ?? { free: false, uncapped: false }),
    administrators: { isAdmin: () => options.admin ?? false },
  });
}

/** The refusal a synchronous gate threw, so the case can assert on its code. */
function refusalOf(run: () => void): { code?: unknown; httpStatus?: unknown } {
  try {
    run();
  } catch (error) {
    return error as { code?: unknown; httpStatus?: unknown };
  }

  throw new Error("expected the gate to refuse, but it returned");
}

describe("given the permission a scope write demands", () => {
  it("asks a project for project:update rather than project:manage", () => {
    expect(DataRetentionPolicyService.requiredWritePermission("PROJECT")).toBe("project:update");
    expect(DataRetentionPolicyService.requiredWritePermission("TEAM")).toBe("team:manage");
    expect(DataRetentionPolicyService.requiredWritePermission("ORGANIZATION")).toBe(
      "organization:manage",
    );
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
    /** @scenario "A retention rule a caller has no standing to write is refused by name" */
    it("refuses by name, carrying the permission the scope needs", async () => {
      await expect(
        policy({ allow: false }).assertCanWriteScope({
          actor: ACTOR,
          scope: { scopeType: "TEAM", scopeId: "team_1" },
        }),
      ).rejects.toMatchObject({
        code: "data_retention_scope_write_forbidden",
        httpStatus: 403,
        meta: { requiredPermission: "team:manage" },
      });
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
      ).rejects.toMatchObject({
        code: "data_retention_scope_target_not_found",
        httpStatus: 404,
      });
    });
  });

  describe("when the organization is on a free plan", () => {
    /** @scenario "A retention rule saved on a free plan is refused by name" */
    it("refuses by name", async () => {
      await expect(
        policy({ plan: { free: true, uncapped: false } }).assertPlanForProject({
          actor: ACTOR,
          projectId: "proj_a",
        }),
      ).rejects.toMatchObject({ code: "data_retention_not_on_plan", httpStatus: 403 });
    });
  });

  describe("when the project no longer sits in an organization", () => {
    /** @scenario "A retention rule saved from a project with no organization is refused by name" */
    it("refuses by name rather than gating on a plan it cannot resolve", async () => {
      await expect(
        policy({ organizationId: null }).assertPlanForProject({
          actor: ACTOR,
          projectId: "proj_a",
        }),
      ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
    });
  });
});

describe("given a value a plan may or may not persist", () => {
  /** @scenario "A retention length the plan does not offer is refused by name" */
  it("allows only the fixed presets on a capped plan", () => {
    const capped = { free: false, uncapped: false };
    expect(() =>
      DataRetentionPolicyService.assertPlanAllowsRetentionValue(capped, 35),
    ).not.toThrow();
    expect(() =>
      DataRetentionPolicyService.assertPlanAllowsRetentionValue(capped, 63),
    ).not.toThrow();
    expect(
      refusalOf(() => DataRetentionPolicyService.assertPlanAllowsRetentionValue(capped, 98)),
    ).toMatchObject({ code: "data_retention_length_not_on_plan", httpStatus: 403 });
  });

  /** @scenario "A retention length under the plan's floor is told the floor" */
  it("allows any whole-week value at or above the floor on an uncapped plan", () => {
    const uncapped = { free: false, uncapped: true };
    expect(() =>
      DataRetentionPolicyService.assertPlanAllowsRetentionValue(uncapped, 49),
    ).not.toThrow();
    expect(() =>
      DataRetentionPolicyService.assertPlanAllowsRetentionValue(uncapped, 700),
    ).not.toThrow();
    // The paid short presets stay the sole exceptions below the floor.
    expect(() =>
      DataRetentionPolicyService.assertPlanAllowsRetentionValue(uncapped, 35),
    ).not.toThrow();
    expect(
      refusalOf(() => DataRetentionPolicyService.assertPlanAllowsRetentionValue(uncapped, 42)),
    ).toMatchObject({
      code: "data_retention_length_below_plan_minimum",
      meta: { minimumDays: 49 },
    });
  });

  it("leaves the indefinite sentinel to the platform-administrator gate", () => {
    expect(() =>
      DataRetentionPolicyService.assertPlanAllowsRetentionValue(
        { free: false, uncapped: false },
        0,
      ),
    ).not.toThrow();
  });
});

describe("given a request to disable retention entirely", () => {
  describe("when the caller is not a platform administrator", () => {
    /** @scenario "A request to keep data forever is refused by name" */
    it("refuses by name", () => {
      expect(
        refusalOf(() => policy({ admin: false }).assertCanDisableRetention({ actor: ACTOR })),
      ).toMatchObject({ code: "data_retention_disable_forbidden", httpStatus: 403 });
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
