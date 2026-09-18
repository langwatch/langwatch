/**
 * Who a grant write is attributed to in the ledger (ADR-092), for callers
 * that already have the raw ids in hand — a user id, an API key id, or
 * neither. Framework-free (only a type import, erased at build time) so
 * both server code and the app/api layer can share it.
 */
import type { LedgerActor } from "@langwatch/authz-server";

/**
 * Every system principal a grant write can be attributed to, named by the
 * surface that acts as nobody. Adding a caller means adding one entry here,
 * not inventing a fresh `"system:..."` string at the call site.
 */
export const SYSTEM_ACTORS = {
  managementApi: "system:management-api",
  organizationService: "system:organization-service",
  apiKeyService: "system:api-key-service",
  inviteService: "system:invite-service",
  migrationRunner: "system:migration-runner",
  personalWorkspace: "system:personal-workspace",
  readThroughMint: "system:read-through-mint",
  ssoAutoJoin: "system:sso-auto-join",
  scim: "system:scim",
} as const satisfies Record<string, string>;

export type SystemActorName = keyof typeof SYSTEM_ACTORS;

/**
 * A user id if the write is attributable to a person; an API key id if it
 * is attributable to a credential acting for nobody; otherwise `fallback`,
 * the system principal named for the surface making the write.
 */
export function ledgerActorFor({
  userId,
  apiKeyId,
  fallback,
}: {
  userId?: string | null;
  apiKeyId?: string | null;
  fallback: SystemActorName;
}): LedgerActor {
  if (userId) return { type: "user", id: userId };
  if (apiKeyId) return { type: "system", id: `apikey:${apiKeyId}` };
  return { type: "system", id: SYSTEM_ACTORS[fallback] };
}
