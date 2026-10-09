/**
 * Every system principal a write can be attributed to, named by the surface
 * that acts as nobody. Adding a caller means adding one entry here, not
 * inventing a fresh `"system:..."` string at the call site.
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
  /** ADR-177: the materialiser that turns an aggregate project's scope rule
   *  into shared project-reader grants and revokes them when it changes. */
  aggregateReconciler: "system:aggregate-reconciler",
  /** Policy-driven auto-approval of a join request. An approval a person
   *  made carries that person as a user actor instead. */
  joinRequests: "system:join-requests",
  /** A self-hosted license resolving to its managed gateway key. No person
   *  is present: the gateway asks on behalf of an install. */
  connectLicense: "system:connect-license",
  /** A run nobody started (a monitor, an online evaluation, a scheduled suite) calling back
   *  with its ownerless run key. Never the creator of the thing that started it. */
  unattendedRun: "system:unattended-run",
} as const satisfies Record<string, `system:${string}`>;

export type SystemActorName = keyof typeof SYSTEM_ACTORS;
