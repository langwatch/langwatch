import { ALL_PERMISSIONS } from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { hasPermissionWithHierarchy } from "../../api/rbac";
import { CustomRolePermissionsSchema } from "../../rbac/custom-role-permissions";
import {
  CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS,
  defaultCliKeyPermissions,
} from "../cli-key-defaults";
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
    // Which categories claim each permission, rather than whether any does:
    // the categories partition the registry, so a permission owned by two of
    // them is as wrong as one owned by none. A flat Set hides that, and the
    // second owner is what silently widens a key — granting one category
    // would hand over another category's resources. Read and write of the
    // SAME category both naming a permission is the intended shape, since a
    // write level always carries its own reads.
    const owners = new Map<string, string[]>();
    for (const category of PERMISSION_CATEGORIES) {
      for (const permission of new Set([
        ...category.readPermissions,
        ...category.writePermissions,
      ])) {
        owners.set(permission, [
          ...(owners.get(permission) ?? []),
          category.key,
        ]);
      }
    }

    const uncovered = categorizablePermissions().filter(
      (permission) => !owners.has(permission),
    );
    expect(
      uncovered,
      "Registry permissions missing from PERMISSION_CATEGORIES — add them to a category",
    ).toEqual([]);

    const claimedTwice = [...owners.entries()]
      .filter(([, categoryKeys]) => categoryKeys.length > 1)
      .map(
        ([permission, categoryKeys]) =>
          `${permission}: ${categoryKeys.join(", ")}`,
      );
    expect(
      claimedTwice,
      "Permissions claimed by more than one category — granting one category would hand over the other's resources",
    ).toEqual([]);

    // The only permissions outside the categories are the platform tier,
    // which can never ride on an API key — so no category may name one.
    const categorizable = new Set<string>(categorizablePermissions());
    const platformOnly = ALL_PERMISSIONS.filter(
      (permission) => !categorizable.has(permission),
    );
    expect(platformOnly).toEqual(["ops:view", "ops:manage"]);

    const platformInCategory = platformOnly.filter((permission) =>
      owners.has(permission),
    );
    expect(
      platformInCategory,
      "Platform-tier permissions cannot ride on an API key — remove them from the categories",
    ).toEqual([]);
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
      { category: "Agent Cache", accessLevels: "read, write" },
      { category: "Audit Log", accessLevels: "read" },
      { category: "Team", accessLevels: "read, write" },
      { category: "Project", accessLevels: "read, write" },
      { category: "Organization", accessLevels: "read, write" },
      { category: "Gateway", accessLevels: "read, write" },
      { category: "Governance", accessLevels: "read, write" },
    ]);
  });

  /** @scenario Project write carries creation and deletion, because manage implies them */
  it("keeps the whole project resource in one category", () => {
    expect(categoryPermissions({ key: "project", level: "write" })).toEqual([
      "project:view",
      "project:create",
      "project:update",
      "project:delete",
      "project:manage",
    ]);
    // Why they cannot be offered separately: the request path answers a
    // create or delete check with the category's own manage grant, so a
    // narrower category would describe a separation that does not exist.
    expect(
      hasPermissionWithHierarchy(["project:manage"], "project:create"),
    ).toBe(true);
    expect(
      hasPermissionWithHierarchy(["project:manage"], "project:delete"),
    ).toBe(true);
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

  describe("when a category is read-only", () => {
    it("never invents a write selection for it", () => {
      expect(selectionsFromPermissions(["cost:view"]).cost).toBe("read");
      expect(selectionsFromPermissions(["auditLog:view"]).auditLog).toBe(
        "read",
      );
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

    expect(seed.project).toBe("write");
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
  it("holds the organization exclusions in effect, not only in the list", () => {
    const defaults = defaultCliKeyPermissions();

    // An exclusion is only real when the request path agrees: the hierarchy
    // promotes a `:create`, `:update` or `:delete` check to the resource's
    // own `:manage`, so an excluded permission must not be reachable that way.
    for (const excluded of CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS) {
      expect(hasPermissionWithHierarchy(defaults, excluded)).toBe(false);
    }
  });

  /** @scenario project administration rides along with project settings */
  it("grants project administration with project:manage, and says so", () => {
    const defaults = defaultCliKeyPermissions();

    // `project:manage` is in the defaults because model providers, project
    // settings and topic clustering check it, and it answers a create or
    // delete check too. The list names both rather than implying an
    // exclusion the request path would not honour.
    expect(defaults).toContain("project:manage");
    expect(defaults).toContain("project:create");
    expect(defaults).toContain("project:delete");
    expect(
      hasPermissionWithHierarchy(["project:manage"], "project:create"),
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
