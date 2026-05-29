import type { Permission } from "~/server/api/rbac";

/**
 * The access decision for a single HTTP route. Every route mounted through the
 * secured app builder must declare exactly one of these — that is the whole
 * point: the access decision is a mandatory, reviewable property of the route,
 * not a positional middleware a developer can forget.
 *
 *   - permission       — the caller's credential must hold this RBAC permission
 *                        at the app's scope (project or organization).
 *   - patPermission    — like `permission`, but enforced through the API-key
 *                        ceiling: legacy project API keys retain full access
 *                        while personal access tokens must hold the permission.
 *                        Use for the public REST surface (gateway-platform,
 *                        governance) so the registry records the real
 *                        permission instead of a blanket "any authenticated".
 *   - anyAuthenticated — any valid credential for the app's scope; no specific
 *                        permission. Use sparingly and only when the handler
 *                        itself does no privileged read/write.
 *   - public           — intentionally unauthenticated (health probes, OAuth
 *                        handshakes, share links). The reason is mandatory and
 *                        surfaces in the route registry for review.
 *   - internal         — service-to-service, authenticated by a shared secret
 *                        or signature rather than an RBAC credential (collector,
 *                        cron, gateway-internal, webhooks). Reason mandatory.
 */
export type AccessPolicy =
  | { readonly kind: "permission"; readonly permission: Permission }
  | { readonly kind: "patPermission"; readonly permission: Permission }
  | { readonly kind: "anyAuthenticated" }
  | { readonly kind: "public"; readonly reason: string }
  | { readonly kind: "internal"; readonly reason: string }
  | { readonly kind: "handlerManaged"; readonly reason: string };

/**
 * Require a specific RBAC permission at the app's scope. The secured app
 * resolves it against the caller's role bindings (project scope) or org role
 * bindings (org scope), exactly like the tRPC `checkProjectPermission` path.
 */
export function requires(permission: Permission): AccessPolicy {
  return { kind: "permission", permission };
}

/**
 * Require an RBAC permission through the API-key ceiling. Legacy project API
 * keys bypass the ceiling (full access — the historical behaviour of project
 * keys); personal access tokens must satisfy `effective = ApiKey ∩ user` for
 * the permission at the project scope. This is the public REST surface's
 * equivalent of `requires(...)`, kept distinct so the registry records that
 * the gate is the PAT ceiling rather than a strict role check.
 */
export function patPermission(permission: Permission): AccessPolicy {
  return { kind: "patPermission", permission };
}

/**
 * Any valid credential for the app's scope is accepted; no specific permission
 * is checked. Reserve for routes whose handler performs no privileged action
 * beyond what authentication already proves (e.g. "whoami").
 */
export function anyAuthenticated(): AccessPolicy {
  return { kind: "anyAuthenticated" };
}

/**
 * Intentionally unauthenticated. `reason` is mandatory and must be non-empty —
 * it is the reviewable justification that this route is safe to expose without
 * credentials.
 */
export function publicEndpoint(reason: string): AccessPolicy {
  assertReason(reason, "publicEndpoint");
  return { kind: "public", reason };
}

/**
 * Service-to-service route authenticated by a shared secret or signature, not
 * an RBAC credential. `reason` is mandatory.
 */
export function internalSecret(reason: string): AccessPolicy {
  assertReason(reason, "internalSecret");
  return { kind: "internal", reason };
}

/**
 * The route authenticates and authorizes WITHIN its handler (legacy pattern:
 * in-handler API-key resolution, `getServerAuthSession`, signature checks, or
 * a framework like tRPC/BetterAuth that runs its own per-request RBAC). The
 * builder applies no auth chain; `reason` documents how the handler enforces
 * access so the route is still a reviewable registry entry rather than an
 * unaccounted-for endpoint. Prefer a real `requires(...)` / `internalSecret(...)`
 * strategy when the auth can be expressed as middleware.
 */
export function handlerManagedAuth(reason: string): AccessPolicy {
  assertReason(reason, "handlerManagedAuth");
  return { kind: "handlerManaged", reason };
}

function assertReason(reason: string, fn: string): void {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error(
      `${fn}() requires a non-empty reason describing why the route needs no RBAC credential`,
    );
  }
}

/** Human-readable one-liner for registry listings + audit output. */
export function describeAccessPolicy(policy: AccessPolicy): string {
  switch (policy.kind) {
    case "permission":
      return `requires ${policy.permission}`;
    case "patPermission":
      return `requires ${policy.permission} (PAT ceiling; legacy project keys bypass)`;
    case "anyAuthenticated":
      return "any authenticated credential";
    case "public":
      return `public — ${policy.reason}`;
    case "internal":
      return `internal — ${policy.reason}`;
    case "handlerManaged":
      return `handler-managed — ${policy.reason}`;
  }
}
