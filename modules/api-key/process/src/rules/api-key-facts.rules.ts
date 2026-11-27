import {
  AGENT_SANDBOX_API_KEY_NAME,
  CHECKUP_CANARY_API_KEY_NAME,
  CLI_LOGIN_KEY_NAME_PREFIX,
  DOCS_SESSION_API_KEY_NAME,
  HIDDEN_SYSTEM_KEY_NAMES,
  LANGY_SESSION_API_KEY_NAME,
  STAFF_READ_KEY_NAME,
  STAFF_SUPPORT_KEY_NAME,
  TRACE_EXPORT_API_KEY_NAME,
  WORKFLOW_RUN_API_KEY_NAME,
  type ApiKeyFacts,
  type ApiKeyKind,
} from "@langwatch/api-key-contract";

import type { StoredApiKey } from "../repositories/api-key.repository.ts";

/** The names only LangWatch mints under, read as a kind only on a system key. */
const SYSTEM_KEY_KINDS: ReadonlyMap<string, ApiKeyKind> = new Map([
  [STAFF_READ_KEY_NAME, "staff_read"],
  [STAFF_SUPPORT_KEY_NAME, "staff_support"],
  [LANGY_SESSION_API_KEY_NAME, "langy_session"],
  [AGENT_SANDBOX_API_KEY_NAME, "agent_sandbox"],
  [WORKFLOW_RUN_API_KEY_NAME, "workflow_run"],
  [TRACE_EXPORT_API_KEY_NAME, "gateway_trace_export"],
  [CHECKUP_CANARY_API_KEY_NAME, "checkup_canary"],
  [DOCS_SESSION_API_KEY_NAME, "docs_session"],
]);

type KindMarks = Pick<
  StoredApiKey,
  "name" | "isSystemManaged" | "ingestSourceType" | "createdByDeviceLabel" | "userId"
>;

/** A key's kind from its stored marks; a customer's own name never makes a key a system kind. */
export function apiKeyKindOf(key: KindMarks): ApiKeyKind {
  const isSystem = key.isSystemManaged === true || HIDDEN_SYSTEM_KEY_NAMES.includes(key.name);
  if (isSystem) return SYSTEM_KEY_KINDS.get(key.name) ?? "system";
  if (key.ingestSourceType !== null) return "ingestion";
  if (key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX) && key.createdByDeviceLabel !== null) {
    return "cli_login";
  }
  return key.userId === null ? "service" : "personal";
}

/** The projects a key reaches when every grant is on a project; empty for a wider key. */
export function apiKeyProjectScopesOf(grants: StoredApiKey["grants"]): string[] {
  if (!grants.every((grant) => grant.scopeType === "PROJECT")) return [];
  return [...new Set(grants.map((grant) => grant.scopeId))];
}

/** Built-in roles as `role:<name>`, plus the permissions of the custom roles the key holds. */
export function apiKeyPermissionsOf({
  grants,
  customRolePermissions,
}: {
  grants: StoredApiKey["grants"];
  customRolePermissions: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const permissions = new Set<string>();
  for (const grant of grants) {
    if (grant.role !== "CUSTOM") {
      permissions.add(`role:${grant.role.toLowerCase()}`);
      continue;
    }
    for (const permission of customRolePermissions.get(grant.customRoleId ?? "") ?? []) {
      permissions.add(permission);
    }
  }
  return [...permissions].toSorted();
}

export function apiKeyFactsOf({
  key,
  customRolePermissions,
}: {
  key: StoredApiKey;
  customRolePermissions: ReadonlyMap<string, readonly string[]>;
}): ApiKeyFacts {
  const projectScopes = apiKeyProjectScopesOf(key.grants);
  return {
    id: key.id,
    kind: apiKeyKindOf(key),
    projectId: projectScopes.length === 1 ? (projectScopes[0] ?? null) : null,
    createdAt: key.createdAt.getTime(),
    lastUsedAt: key.lastUsedAt?.getTime() ?? null,
    expiresAt: key.expiresAt?.getTime() ?? null,
    revokedAt: key.revokedAt?.getTime() ?? null,
    permissions: apiKeyPermissionsOf({ grants: key.grants, customRolePermissions }),
  };
}
