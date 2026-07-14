import type { Permission } from "../api/rbac";

export type AccessLevel = "read" | "write";

export interface PermissionCategory {
  key: string;
  label: string;
  accessLevels: readonly AccessLevel[];
  readPermissions: Permission[];
  writePermissions: Permission[];
}

export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  {
    key: "traces",
    label: "Traces",
    accessLevels: ["read", "write"],
    readPermissions: ["traces:view"],
    writePermissions: [
      "traces:view",
      "traces:create",
      "traces:update",
      "traces:share",
    ],
  },
  {
    key: "cost",
    label: "Cost",
    accessLevels: ["read"],
    readPermissions: ["cost:view"],
    writePermissions: [],
  },
  {
    key: "scenarios",
    label: "Scenarios",
    accessLevels: ["read", "write"],
    readPermissions: ["scenarios:view"],
    writePermissions: ["scenarios:view", "scenarios:manage"],
  },
  {
    key: "annotations",
    label: "Annotations",
    accessLevels: ["read", "write"],
    readPermissions: ["annotations:view"],
    writePermissions: ["annotations:view", "annotations:manage"],
  },
  {
    key: "analytics",
    label: "Analytics",
    accessLevels: ["read", "write"],
    readPermissions: ["analytics:view"],
    writePermissions: ["analytics:view", "analytics:manage"],
  },
  {
    key: "evaluations",
    label: "Evaluations",
    accessLevels: ["read", "write"],
    readPermissions: ["evaluations:view"],
    writePermissions: ["evaluations:view", "evaluations:manage"],
  },
  {
    key: "datasets",
    label: "Datasets",
    accessLevels: ["read", "write"],
    readPermissions: ["datasets:view"],
    writePermissions: ["datasets:view", "datasets:manage"],
  },
  {
    key: "triggers",
    label: "Triggers",
    accessLevels: ["read", "write"],
    readPermissions: ["triggers:view"],
    writePermissions: ["triggers:view", "triggers:manage"],
  },
  {
    key: "workflows",
    label: "Workflows",
    accessLevels: ["read", "write"],
    readPermissions: ["workflows:view"],
    writePermissions: ["workflows:view", "workflows:manage"],
  },
  {
    key: "experiments",
    label: "Experiments",
    accessLevels: ["read", "write"],
    readPermissions: ["experiments:view"],
    writePermissions: ["experiments:view", "experiments:manage"],
  },
  {
    key: "prompts",
    label: "Prompts",
    accessLevels: ["read", "write"],
    readPermissions: ["prompts:view"],
    writePermissions: ["prompts:view", "prompts:manage"],
  },
  {
    key: "secrets",
    label: "Secrets",
    accessLevels: ["read", "write"],
    readPermissions: ["secrets:view"],
    writePermissions: ["secrets:view", "secrets:manage"],
  },
  {
    key: "auditLog",
    label: "Audit Log",
    accessLevels: ["read"],
    readPermissions: ["auditLog:view"],
    writePermissions: [],
  },
  {
    key: "team",
    label: "Team",
    accessLevels: ["read", "write"],
    readPermissions: ["team:view"],
    writePermissions: ["team:view", "team:manage"],
  },
  {
    key: "project",
    label: "Project",
    accessLevels: ["read", "write"],
    readPermissions: ["project:view"],
    writePermissions: [
      "project:view",
      "project:create",
      "project:update",
      "project:delete",
      "project:manage",
    ],
  },
] as const;

export function categoryPermissions({
  key,
  level,
}: {
  key: string;
  level: AccessLevel;
}): Permission[] {
  const category = PERMISSION_CATEGORIES.find((c) => c.key === key);
  if (!category) return [];
  return level === "write"
    ? category.writePermissions
    : category.readPermissions;
}

export function computePermissionsFromSelections(
  selections: Record<string, AccessLevel | "none">,
): Permission[] {
  const permSet = new Set<Permission>();
  for (const [key, level] of Object.entries(selections)) {
    if (level === "none") continue;
    for (const perm of categoryPermissions({ key, level })) {
      permSet.add(perm);
    }
  }
  return [...permSet].sort();
}

export function selectionsFromPermissions(
  permissions: string[],
): Record<string, AccessLevel> {
  const selections: Record<string, AccessLevel> = {};
  for (const category of PERMISSION_CATEGORIES) {
    const hasWrite =
      category.writePermissions.length > 0 &&
      category.writePermissions.every((p) => permissions.includes(p));
    const hasRead = category.readPermissions.every((p) =>
      permissions.includes(p),
    );

    if (hasWrite) {
      selections[category.key] = "write";
    } else if (hasRead) {
      selections[category.key] = "read";
    }
  }
  return selections;
}
