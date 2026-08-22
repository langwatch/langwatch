import { ALL_PERMISSIONS } from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { hasPermissionWithHierarchy } from "../../api/rbac";
import { CustomRolePermissionsSchema } from "../../rbac/custom-role-permissions";
import { defaultCliKeyPermissions } from "../cli-key-defaults";
import {
  categorizablePermissions,
  categoryPermissions,
  computePermissionsFromSelections,
  PERMISSION_CATEGORIES,
  selectionsFromPermissions,
} from "../permission-categories";

describe("PERMISSION_CATEGORIES", () => {
  /** @scenario Every registry permission belongs to a category */
  it("covers every registry permission except the platform tier", () => {
    const covered = new Set<string>(
      PERMISSION_CATEGORIES.flatMap((c) => [
        ...c.readPermissions,
        ...c.writePermissions,
      ]),
    );
    const uncovered = categorizablePermissions().filter(
      (permission) => !covered.has(permission),
    );
    expect(
      uncovered,
      "Registry permissions missing from PERMISSION_CATEGORIES — add them to a category",
    ).toEqual([]);

    // The only permissions outside the categories are the platform tier,
    // which can never ride on an API key.
    const categorizable = new Set<string>(categorizablePermissions());
    const platformOnly = ALL_PERMISSIONS.filter(
      (permission) => !categorizable.has(permission),
    );
    expect(platformOnly).toEqual(["ops:view", "ops:manage"]);
  });

  it("only names permissions that exist in the registry", () => {
    const registry = new Set<string>(ALL_PERMISSIONS);
    const unknown = PERMISSION_CATEGORIES.flatMap((c) => [
      ...c.readPermissions,
      ...c.writePermissions,
    ]).filter((permission) => !registry.has(permission));
    expect(unknown).toEqual([]);
  });

  /** @scenario Permission categories include all platform resources */
  it("lists the categories with their access levels", () => {
    const result = PERMISSION_CATEGORIES.map((c) => ({
      category: c.label,
      accessLevels: c.accessLevels.join(", "),
    }));

    expect(result).toEqual([
      { category: "Traces", accessLevels: "read, write" },
      { category: "Cost", accessLevels: "read" },
      { category: "Scenarios", accessLevels: "read, write" },
      { category: "Annotations", accessLevels: "read, write" },
      { category: "Analytics", accessLevels: "read, write" },
      { category: "Evaluations", accessLevels: "read, write" },
      { category: "Langy", accessLevels: "read, write" },
      { category: "Datasets", accessLevels: "read, write" },
      { category: "Triggers", accessLevels: "read, write" },
      { category: "Workflows", accessLevels: "read, write" },
      { category: "Experiments", accessLevels: "read, write" },
      { category: "Prompts", accessLevels: "read, write" },
      { category: "Playground", accessLevels: "read, write" },
      { category: "Secrets", accessLevels: "read, write" },
      { category: "Audit Log", accessLevels: "read" },
      { category: "Team", accessLevels: "read, write" },
      { category: "Project settings", accessLevels: "read, write" },
      { category: "Project administration", accessLevels: "write" },
      { category: "Organization", accessLevels: "read, write" },
      { category: "Gateway", accessLevels: "read, write" },
      { category: "Governance", accessLevels: "read, write" },
    ]);
  });

  it("splits project creation and deletion away from project settings", () => {
    expect(
      categoryPermissions({ key: "projectSettings", level: "write" }),
    ).toEqual(["project:view", "project:update", "project:manage"]);
    expect(
      categoryPermissions({ key: "projectAdministration", level: "write" }),
    ).toEqual(["project:create", "project:delete"]);
    expect(
      categoryPermissions({ key: "projectAdministration", level: "read" }),
    ).toEqual([]);
  });

  /** @scenario "write" access includes all mutating permissions for that resource */
  it("grants a resource's full registry action set at the write level", () => {
    expect(categoryPermissions({ key: "scenarios", level: "write" })).toEqual([
      "scenarios:view",
      "scenarios:create",
      "scenarios:update",
      "scenarios:delete",
      "scenarios:manage",
    ]);
    expect(categoryPermissions({ key: "traces", level: "write" })).toEqual([
      "traces:view",
      "traces:create",
      "traces:update",
      "traces:share",
    ]);

    const gatewayWrite = categoryPermissions({
      key: "gateway",
      level: "write",
    });
    expect(gatewayWrite).toContain("virtualKeys:viewOtherPersonal");
    expect(gatewayWrite).toContain("gatewaySpend:manage");
    expect(gatewayWrite).toContain("webhookEndpoints:manage");
    expect(gatewayWrite).toContain("routingPolicies:manage");

    const governanceWrite = categoryPermissions({
      key: "governance",
      level: "write",
    });
    expect(governanceWrite).toContain("governance:manage");
    expect(governanceWrite).toContain("aiTools:manage");
    expect(governanceWrite).toContain("complianceExport:view");
  });
});

describe("categoryPermissions()", () => {
  describe("when level is read", () => {
    /** @scenario "read" access maps to view permission */
    it("returns view permission for Traces", () => {
      expect(categoryPermissions({ key: "traces", level: "read" })).toEqual([
        "traces:view",
      ]);
    });

    it("returns every view permission for multi-resource categories", () => {
      expect(categoryPermissions({ key: "gateway", level: "read" })).toEqual([
        "virtualKeys:view",
        "gatewayBudgets:view",
        "gatewayProviders:view",
        "routingPolicies:view",
        "gatewayGuardrails:view",
        "gatewayLogs:view",
        "gatewayUsage:view",
        "gatewayCacheRules:view",
        "gatewaySpend:view",
        "webhookEndpoints:view",
      ]);
    });
  });

  describe("when key is unknown", () => {
    it("returns empty array", () => {
      expect(
        categoryPermissions({ key: "nonexistent", level: "read" }),
      ).toEqual([]);
    });
  });
});

describe("computePermissionsFromSelections()", () => {
  describe("when all categories are none", () => {
    /** @scenario Selecting no categories produces an empty permission set */
    it("returns an empty array", () => {
      expect(
        computePermissionsFromSelections({ traces: "none", cost: "none" }),
      ).toEqual([]);
    });
  });

  describe("when selections is empty object", () => {
    it("returns an empty array", () => {
      expect(computePermissionsFromSelections({})).toEqual([]);
    });
  });

  describe("when mixing read, write, and none", () => {
    it("deduplicates, skips none, and sorts permissions", () => {
      const result = computePermissionsFromSelections({
        traces: "read",
        annotations: "write",
        cost: "none",
      });

      expect(result).toEqual([
        "annotations:create",
        "annotations:delete",
        "annotations:manage",
        "annotations:update",
        "annotations:view",
        "traces:view",
      ]);
    });
  });
});

describe("selectionsFromPermissions()", () => {
  describe("when permissions contain only view entries", () => {
    it("maps to read for those categories", () => {
      const result = selectionsFromPermissions(["traces:view", "cost:view"]);

      expect(result.traces).toBe("read");
      expect(result.cost).toBe("read");
    });
  });

  describe("when permissions come from a key stored before the expanded write lists", () => {
    /** @scenario Older stored keys keep reading as write via the manage hierarchy */
    it("maps [view, manage] to write through the hierarchy", () => {
      const result = selectionsFromPermissions([
        "datasets:view",
        "datasets:manage",
      ]);

      expect(result.datasets).toBe("write");
    });
  });

  describe("when permissions are empty", () => {
    it("returns empty object", () => {
      expect(selectionsFromPermissions([])).toEqual({});
    });
  });

  describe("when a category is write-only", () => {
    it("never invents a read selection for it", () => {
      expect(selectionsFromPermissions([]).projectAdministration).toBe(
        undefined,
      );
      expect(
        selectionsFromPermissions(["project:view"]).projectAdministration,
      ).toBe(undefined);
    });
  });

  describe("when round-tripping through compute and reverse", () => {
    /** @scenario selectionsFromPermissions round-trips with computePermissionsFromSelections */
    it("preserves the original selections", () => {
      const original = {
        traces: "read" as const,
        datasets: "write" as const,
        annotations: "write" as const,
        cost: "read" as const,
      };

      const permissions = computePermissionsFromSelections(original);
      const reversed = selectionsFromPermissions(permissions);

      expect(reversed).toEqual(original);
    });
  });
});

describe("the CLI login key default", () => {
  /** @scenario the organization-management permissions are off by default */
  it("seeds the expected levels from the default permission list", () => {
    const seed = selectionsFromPermissions(defaultCliKeyPermissions());

    expect(seed.projectSettings).toBe("write");
    expect(seed.projectAdministration).toBe(undefined);
    expect(seed.team).toBe("read");
    expect(seed.organization).toBe("read");
    expect(seed.gateway).toBe("write");
    expect(seed.governance).toBe("write");
    expect(seed.traces).toBe("write");
    expect(seed.playground).toBe("write");
    expect(seed.cost).toBe("read");
    expect(seed.auditLog).toBe("read");
  });

  /** @scenario the organization-management permissions are off by default */
  it("cannot reach project creation or deletion through project:manage", () => {
    const defaults = defaultCliKeyPermissions();

    // The exclusion has to hold in effect, not only in the list: the RBAC
    // hierarchy promotes a `:create` or `:delete` check to `:manage` for
    // every other resource, and `project:manage` IS in the defaults because
    // model providers and project settings ride on it.
    expect(defaults).toContain("project:manage");
    expect(hasPermissionWithHierarchy(defaults, "project:create")).toBe(false);
    expect(hasPermissionWithHierarchy(defaults, "project:delete")).toBe(false);
    // The promotion still works everywhere else.
    expect(
      hasPermissionWithHierarchy(["datasets:manage"], "datasets:create"),
    ).toBe(true);
  });

  it("leaves out every platform-tier permission", () => {
    const categorizable = new Set<string>(categorizablePermissions());
    const platformOnly = ALL_PERMISSIONS.filter(
      (permission) => !categorizable.has(permission),
    );
    const defaults = new Set<string>(defaultCliKeyPermissions());

    expect(platformOnly.length).toBeGreaterThan(0);
    expect(
      platformOnly.filter((permission) => defaults.has(permission)),
      "A platform-tier permission reached the CLI login key defaults",
    ).toEqual([]);
  });

  it("round-trips the default permission list exactly", () => {
    const seed = selectionsFromPermissions(defaultCliKeyPermissions());
    const computed = computePermissionsFromSelections(seed);

    expect(new Set(computed)).toEqual(new Set(defaultCliKeyPermissions()));
  });
});

describe("contract: computePermissionsFromSelections → CustomRolePermissionsSchema", () => {
  describe("when every category is set to its max access level", () => {
    /** @scenario All computed permission strings pass the CustomRole schema */
    it("produces permissions that pass the CustomRolePermissionsSchema", () => {
      const allMax: Record<string, "read" | "write"> = {};
      for (const cat of PERMISSION_CATEGORIES) {
        allMax[cat.key] = cat.accessLevels.includes("write") ? "write" : "read";
      }

      const permissions = computePermissionsFromSelections(allMax);
      const result = CustomRolePermissionsSchema.safeParse(permissions);

      expect(result.success).toBe(true);
    });
  });

  describe("when each category is individually set to read", () => {
    it("each produces a schema-valid permission array", () => {
      for (const cat of PERMISSION_CATEGORIES) {
        const permissions = computePermissionsFromSelections({
          [cat.key]: "read",
        });
        const result = CustomRolePermissionsSchema.safeParse(permissions);

        expect(
          result.success,
          `${cat.key} read permissions failed schema: ${JSON.stringify(permissions)}`,
        ).toBe(true);
      }
    });
  });

  describe("when each category is individually set to write", () => {
    it("each produces a schema-valid permission array", () => {
      for (const cat of PERMISSION_CATEGORIES.filter((c) =>
        c.accessLevels.includes("write"),
      )) {
        const permissions = computePermissionsFromSelections({
          [cat.key]: "write",
        });
        const result = CustomRolePermissionsSchema.safeParse(permissions);

        expect(
          result.success,
          `${cat.key} write permissions failed schema: ${JSON.stringify(permissions)}`,
        ).toBe(true);
      }
    });
  });
});
