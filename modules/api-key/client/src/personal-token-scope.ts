import { INGESTION_PERMISSIONS } from "@langwatch/api-key-contract";
import { addDays, nowInstant } from "@langwatch/time";

import type { ApiKeyInputs } from "./api-key-client.ts";

/** One permission a setup token may carry; the server refuses any the creator does not hold. */
export type TokenPermission = (typeof INGESTION_PERMISSIONS)[number];

/**
 * What an MCP config needs: read (never send or change) the project data its read tools reach.
 * Secrets, model providers and keys are left out on purpose.
 */
export const PROJECT_READ_PERMISSIONS: readonly TokenPermission[] = [
  "traces:view",
  "analytics:view",
  "prompts:view",
  "scenarios:view",
  "evaluations:view",
  "datasets:view",
  "experiments:view",
  "workflows:view",
  "annotations:view",
  "triggers:view",
  "project:view",
];

const PHRASES: Partial<Record<TokenPermission, string>> = {
  "prompts:view": "read prompts",
  "evaluations:manage": "manage evaluations",
  "workflows:manage": "manage workflows",
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((permission) => b.includes(permission));

/** The banner's sentence: what a token with these permissions can do, and only that. */
export function tokenScopeNote({
  permissions,
}: {
  permissions: readonly TokenPermission[];
}): string {
  if (sameSet(permissions, INGESTION_PERMISSIONS)) {
    return "This token can only send data to this project. It can't read or change anything.";
  }
  if (sameSet(permissions, PROJECT_READ_PERMISSIONS)) {
    return "This token can read this project's data. It can't send or change anything.";
  }
  const phrases = permissions.map((permission) => PHRASES[permission] ?? permission);
  return `This token can ${phrases.join(" and ")} in this project and nothing else.`;
}

/** A restricted personal key on one project holding only `permissions`, expiring in 90 days. */
export function personalTokenInput({
  organizationId,
  projectId,
  name,
  permissions = INGESTION_PERMISSIONS,
}: {
  organizationId: string;
  projectId: string;
  name: string;
  permissions?: readonly TokenPermission[];
}): ApiKeyInputs["apiKey"]["create"] {
  return {
    organizationId,
    name,
    keyType: "personal",
    permissionMode: "restricted",
    permissions: [...permissions],
    expiresAt: addDays(nowInstant().epochMilliseconds, 90).toISOString(),
    bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
  };
}
