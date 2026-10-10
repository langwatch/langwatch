import type { ModelDefaultScope } from "@langwatch/model-provider-contract";

/** What writing a default-model scope requires. */
export function modelDefaultWritePermission(
  scopeType: ModelDefaultScope["scopeType"],
): "organization:manage" | "team:manage" | "project:update" {
  if (scopeType === "ORGANIZATION") return "organization:manage";
  if (scopeType === "TEAM") return "team:manage";

  return "project:update";
}
