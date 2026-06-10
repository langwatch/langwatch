import { describe, expect, it } from "vitest";
import { Resources } from "../../api/rbac";
import { CustomRolePermissionsSchema } from "../../rbac/custom-role-permissions";
import {
  categoryPermissions,
  computePermissionsFromSelections,
  PERMISSION_CATEGORIES,
  selectionsFromPermissions,
} from "../permission-categories";

const RESOURCES_EXCLUDED_FROM_API_KEY_CATEGORIES = new Set<string>([
  Resources.ORGANIZATION,
  Resources.PLAYGROUND,
  Resources.OPS,
  Resources.VIRTUAL_KEYS,
  Resources.GATEWAY_BUDGETS,
  Resources.GATEWAY_PROVIDERS,
  Resources.GATEWAY_GUARDRAILS,
  Resources.GATEWAY_LOGS,
  Resources.GATEWAY_USAGE,
  Resources.GATEWAY_CACHE_RULES,
  // Iter 110 governance resources — admin-config surfaces governed by
  // RoleBinding alone, never reachable through user-issued API keys.
  Resources.ROUTING_POLICIES,
  Resources.GOVERNANCE,
  Resources.INGESTION_SOURCES,
  Resources.ANOMALY_RULES,
  Resources.COMPLIANCE_EXPORT,
  Resources.ACTIVITY_MONITOR,
  Resources.AI_TOOLS,
]);

describe("PERMISSION_CATEGORIES", () => {
  it("covers every non-excluded Resource from the RBAC source of truth", () => {
    const categoryResources = new Set(PERMISSION_CATEGORIES.map((c) => c.key));
    const allResources = Object.values(Resources);
    const uncovered = allResources.filter(
      (r) =>
        !categoryResources.has(r) &&
        !RESOURCES_EXCLUDED_FROM_API_KEY_CATEGORIES.has(r),
    );
    expect(
      uncovered,
      "Resources missing from PERMISSION_CATEGORIES — add a category or mark as excluded",
    ).toEqual([]);
  });

  /** @scenario Permission categories include all platform resources */
  it("includes all 14 platform resource categories with correct access levels", () => {
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
      { category: "Datasets", accessLevels: "read, write" },
      { category: "Triggers", accessLevels: "read, write" },
      { category: "Workflows", accessLevels: "read, write" },
      { category: "Experiments", accessLevels: "read, write" },
      { category: "Prompts", accessLevels: "read, write" },
      { category: "Secrets", accessLevels: "read, write" },
      { category: "Audit Log", accessLevels: "read" },
      { category: "Team", accessLevels: "read, write" },
      { category: "Project", accessLevels: "read, write" },
    ]);
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
  });

  describe("when level is write", () => {
    /** @scenario "write" access includes all mutating permissions for that resource */
    it("returns all mutating permissions per category", () => {
      const results = PERMISSION_CATEGORIES.filter((c) =>
        c.accessLevels.includes("write"),
      ).map((c) => ({
        category: c.label,
        permissions: categoryPermissions({ key: c.key, level: "write" }).join(
          ", ",
        ),
      }));

      expect(results).toEqual([
        {
          category: "Traces",
          permissions:
            "traces:view, traces:create, traces:update, traces:share",
        },
        {
          category: "Scenarios",
          permissions: "scenarios:view, scenarios:manage",
        },
        {
          category: "Annotations",
          permissions: "annotations:view, annotations:manage",
        },
        {
          category: "Analytics",
          permissions: "analytics:view, analytics:manage",
        },
        {
          category: "Evaluations",
          permissions: "evaluations:view, evaluations:manage",
        },
        {
          category: "Datasets",
          permissions: "datasets:view, datasets:manage",
        },
        {
          category: "Triggers",
          permissions: "triggers:view, triggers:manage",
        },
        {
          category: "Workflows",
          permissions: "workflows:view, workflows:manage",
        },
        {
          category: "Experiments",
          permissions: "experiments:view, experiments:manage",
        },
        { category: "Prompts", permissions: "prompts:view, prompts:manage" },
        { category: "Secrets", permissions: "secrets:view, secrets:manage" },
        { category: "Team", permissions: "team:view, team:manage" },
        {
          category: "Project",
          permissions:
            "project:view, project:create, project:update, project:delete, project:manage",
        },
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
        "annotations:manage",
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

  describe("when permissions contain manage entries", () => {
    it("maps to write for those categories", () => {
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
