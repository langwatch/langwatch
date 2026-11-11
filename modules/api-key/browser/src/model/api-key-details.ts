// What the key details view reads off a listed key. Pure: no secret is in the row to read.
// Spec: specs/api-keys/api-key-rotation.feature

import { PERMISSION_CATEGORIES, selectionsFromPermissions } from "@langwatch/api-key-contract";

import { bindingsToSelections, teamRolePermissions } from "./api-key-permissions.ts";

type DetailsKey = {
  permissionMode: string;
  grants: { role: string; customRoleId: string | null; customRolePermissions: string[] | null }[];
};

export type CategoryAccess = { key: string; label: string; access: "Read" | "Read and write" };

/** The categories a restricted key may reach, and how far; empty for an all-permissions key. */
export function restrictedCategoryAccess({ apiKey }: { apiKey: DetailsKey }): CategoryAccess[] {
  if (apiKey.permissionMode !== "restricted") return [];
  const selections = bindingsToSelections(apiKey, {
    permissionCategories: PERMISSION_CATEGORIES,
    selectionsFromPermissions,
    getTeamRolePermissions: teamRolePermissions,
  });

  return PERMISSION_CATEGORIES.flatMap((category): CategoryAccess[] => {
    const selection = selections[category.key];
    if (selection === "write") {
      return [{ key: category.key, label: category.label, access: "Read and write" }];
    }
    if (selection === "read") return [{ key: category.key, label: category.label, access: "Read" }];
    return [];
  });
}

/** The masked hint a key is shown by: its public prefix, never any part of the secret. */
export function maskedKeyHint({ lookupIdPrefix }: { lookupIdPrefix: string }): string {
  return `sk-lw-${lookupIdPrefix}…`;
}
