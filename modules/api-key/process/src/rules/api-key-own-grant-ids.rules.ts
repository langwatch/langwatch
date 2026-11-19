/**
 * The ids a key's create writes its own role and its grants under, the same on every try: authz
 * keeps one fact per command id, so a retried create records one role definition and one of each
 * grant, with one audit row each (tasks#1139). An edit sends none, so every edit is a new fact.
 */
import { createHash } from "node:crypto";

import type { ApiKeyScope } from "@langwatch/api-key-contract";
import { API_KEY_OWN_GRANT_COMMAND_PREFIX } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

const scopeOf = (binding: ApiKeyScope) =>
  JSON.stringify([binding.role, binding.customRoleId ?? null, binding.scopeType, binding.scopeId]);

/**
 * One key's create as one fact: its id plus what it grants, permissions and bindings in any
 * order. A create re-prepared with other content (a custom role changed between tries, say) is
 * another fact under another id.
 */
export function ownGrantCommandId({
  apiKeyId,
  permissions,
  bindings,
}: {
  apiKeyId: string;
  permissions: readonly string[];
  bindings: readonly ApiKeyScope[];
}): string {
  const content = JSON.stringify({
    permissions: [...permissions].toSorted(),
    bindings: bindings.map(scopeOf).toSorted(),
  });
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 32);
  return `${API_KEY_OWN_GRANT_COMMAND_PREFIX}${apiKeyId}:${digest}`;
}

/** The parts of a binding's KSUID, derived from the command id so every try yields the same id. */
export function ownGrantBindingKsuidParts({
  commandId,
  binding,
  createdAt,
}: {
  commandId: string;
  binding: ApiKeyScope;
  createdAt: Instant;
}): { timestamp: number; instanceBytes: Uint8Array; sequenceId: number } {
  const digest = createHash("sha256")
    .update(JSON.stringify([commandId, scopeOf(binding)]))
    .digest();
  return {
    timestamp: Math.floor(createdAt.epochMilliseconds / 1000),
    instanceBytes: new Uint8Array(digest.buffer, digest.byteOffset, 8),
    sequenceId: digest.readUInt32BE(8),
  };
}
