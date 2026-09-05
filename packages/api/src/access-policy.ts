import type { AuthzPermission } from "@langwatch/authz-contract";

/**
 * The access decision for a single HTTP route. Every route mounted through the secured app builder
 * must declare exactly one of these — that is the whole point: the access decision is a mandatory,
 * reviewable property of the route, not a positional middleware a developer can forget.
 */
export type AccessPolicy =
  | { readonly kind: "permission"; readonly permission: AuthzPermission }
  | { readonly kind: "apiKeyPermission"; readonly permission: AuthzPermission }
  | {
      readonly kind: "projectPermission";
      readonly permission: AuthzPermission;
      /** Route param naming the project. Defaults to `id`. */
      readonly param: string;
    }
  | {
      readonly kind: "teamPermission";
      readonly permission: AuthzPermission;
      /** Route param naming the team. Defaults to `id`. */
      readonly param: string;
    }
  | { readonly kind: "anyAuthenticated" }
  | { readonly kind: "public"; readonly reason: string }
  | { readonly kind: "internal"; readonly reason: string }
  | {
      readonly kind: "handlerManaged";
      readonly reason: string;
      /**
       * The RBAC permissions the handler enforces for itself; `[]` when it
       * gates on something that is not an RBAC permission. Mandatory — see
       * `handlerManagedAuth` for why the optional version was a defect.
       */
      readonly permissions: readonly AuthzPermission[];
      /**
       * What kind of credential reaches this route:
       */
      readonly credential: HandlerCredential;
    };

/** @see the `credential` field on the handler-managed policy. */
export type HandlerCredential = "apiKey" | "session" | "both" | "internal";

/**
 * Which credential an API consumer presents to reach a route.
 */
export type CredentialClass =
  | "project_api_key"
  | "organization_api_key"
  /**
   * The instance administrator key a self-hosted operator configures. It is a
   * shared secret by enforcement and an API credential by audience: it exists
   * to create the first organization, before any organization key can, so it
   * is the one secret the published document has a scheme for.
   */
  | "instance_admin_api_key"
  /**
   * The SCIM token an identity provider presents on the provisioning
   * endpoints. Enforced by the family's own bearer check rather than the RBAC
   * chain, and held by a directory connection rather than by us, so the
   * document declares a scheme for it too.
   */
  | "scim_token"
  | "session"
  | "internal"
  | "none";

/**
 * The credential class a route reaches by, from the app it is mounted on and
 * the policy it declares.
 */
export function credentialClassFor({
  scope,
  policy,
}: {
  scope: AppScope;
  policy: AccessPolicy;
}): CredentialClass {
  if (policy.kind === "public") return "none";
  if (policy.kind === "internal") return "internal";
  if (policy.kind === "handlerManaged") {
    return handlerManagedCredentialClass({
      scope,
      credential: policy.credential,
    });
  }
  return CLASS_BY_APP_SCOPE[scope];
}

/** The app families a route can be mounted on. */
type AppScope = "project" | "organization" | "service" | "session";

/** What each app answers for a route that does not opt out of its family. */
const CLASS_BY_APP_SCOPE = {
  project: "project_api_key",
  organization: "organization_api_key",
  service: "internal",
  session: "session",
} as const satisfies Record<AppScope, CredentialClass>;

/** @see credentialClassFor, which is where the reasoning lives. */
function handlerManagedCredentialClass({
  scope,
  credential,
}: {
  scope: AppScope;
  credential: HandlerCredential;
}): CredentialClass {
  if (credential === "internal") return "internal";
  if (credential === "session") return "session";
  // apiKey / both, on an app whose scope names no key family of its own.
  if (scope === "service" || scope === "session") return "project_api_key";
  return CLASS_BY_APP_SCOPE[scope];
}

/**
 * Require a specific RBAC permission at the app's scope. The secured app
 * resolves it against the caller's role bindings (project scope) or org role
 * bindings (org scope), exactly like the tRPC `checkProjectPermission` path.
 */
export function requires<P extends AuthzPermission>(
  permission: P,
): { readonly kind: "permission"; readonly permission: P } {
  return { kind: "permission", permission };
}

/**
 * Require an RBAC permission through the API-key ceiling. Legacy project API keys bypass the ceiling (full access — the historical behaviour of
 * project keys); scoped API keys must satisfy `effective = ApiKey ∩ user` for the permission at the project scope. This is the public REST surface's
 * equivalent of `requires(...)`, kept distinct so the registry records that the gate is the API-key ceiling rather than a strict role check.
 */
export function apiKeyPermission<P extends AuthzPermission>(
  permission: P,
): { readonly kind: "apiKeyPermission"; readonly permission: P } {
  return { kind: "apiKeyPermission", permission };
}

/**
 * Require an RBAC permission at the scope of the project the route addresses, for org apps
 * that operate on one project at a time. `requires(...)` would resolve at organization
 * scope there, so a single org-wide grant would reach every project in the org.
 */
export function requiresOnProject<P extends AuthzPermission>(
  permission: P,
  options: { param?: string } = {},
): {
  readonly kind: "projectPermission";
  readonly permission: P;
  readonly param: string;
} {
  return {
    kind: "projectPermission",
    permission,
    param: options.param ?? "id",
  };
}

/**
 * Require an RBAC permission at the scope of the team the route addresses, for org apps that operate on one team
 * at a time. The project twin's reasoning applies unchanged: `requires(...)` resolves at organization scope, so a
 * team-scoped binding could never pass and an org-wide grant reached every team in the org.
 */
export function requiresOnTeam<P extends AuthzPermission>(
  permission: P,
  options: { param?: string } = {},
): {
  readonly kind: "teamPermission";
  readonly permission: P;
  readonly param: string;
} {
  return {
    kind: "teamPermission",
    permission,
    param: options.param ?? "id",
  };
}

/**
 * Any valid credential for the app's scope is accepted; no specific permission
 * is checked. Reserve for routes whose handler performs no privileged action
 * beyond what authentication already proves (e.g. "whoami").
 */
export function anyAuthenticated(): { readonly kind: "anyAuthenticated" } {
  return { kind: "anyAuthenticated" };
}

/**
 * Intentionally unauthenticated. `reason` is mandatory and must be non-empty —
 * it is the reviewable justification that this route is safe to expose without
 * credentials.
 */
export function publicEndpoint(reason: string): {
  readonly kind: "public";
  readonly reason: string;
} {
  assertReason(reason, "publicEndpoint");
  return { kind: "public", reason };
}

/**
 * Service-to-service route authenticated by a shared secret or signature, not
 * an RBAC credential. `reason` is mandatory.
 */
export function internalSecret(reason: string): {
  readonly kind: "internal";
  readonly reason: string;
} {
  assertReason(reason, "internalSecret");
  return { kind: "internal", reason };
}

/**
 * The route authenticates and authorizes WITHIN its handler (legacy pattern: in-handler API-key resolution, `getServerAuthSession`, signature checks, or a framework like tRPC/BetterAuth
 * that runs its own per-request RBAC). The builder applies no auth chain; `reason` documents how the handler enforces access so the route is still a reviewable registry entry rather than
 * an unaccounted-for endpoint. Prefer a real `requires(...)` / `internalSecret(...)` strategy when the auth can be expressed as middleware.
 */
export function handlerManagedAuth({
  reason,
  permissions,
  credential,
}: {
  reason: string;
  /** Which credential reaches this route. @see the policy type. */
  credential: HandlerCredential;
  /**
   * The RBAC permissions this handler enforces for itself — `[]` when it gates
   * on something that is not an RBAC permission (an internal secret, a raw
   * session check, a signature).
   */
  permissions: readonly AuthzPermission[];
}): Extract<AccessPolicy, { kind: "handlerManaged" }> {
  assertReason(reason, "handlerManagedAuth");
  return { kind: "handlerManaged", reason, permissions, credential };
}

/**
 * Can a caller holding an API key reach this route at all?
 */
export function isApiKeyReachable(policy: AccessPolicy): boolean {
  if (policy.kind === "handlerManaged") {
    return policy.credential === "apiKey" || policy.credential === "both";
  }
  return policy.kind !== "public" && policy.kind !== "internal";
}

/**
 * Every RBAC permission a route requires, whichever way it declares it — middleware policy
 * or self-enforcing handler. The single place any audit should ask "what does this route
 * actually demand?", so a new policy kind cannot quietly drop out of the answer.
 */
export function policyPermissions(policy: AccessPolicy): readonly AuthzPermission[] {
  switch (policy.kind) {
    case "permission":
    case "apiKeyPermission":
    case "projectPermission":
    case "teamPermission":
      return [policy.permission];
    case "handlerManaged":
      return policy.permissions;
    case "anyAuthenticated":
    case "public":
    case "internal":
      return [];
  }
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
    case "apiKeyPermission":
      return `requires ${policy.permission} (API-key ceiling; legacy project keys bypass)`;
    case "projectPermission":
      return `requires ${policy.permission} on the project in :${policy.param}`;
    case "teamPermission":
      return `requires ${policy.permission} on the team in :${policy.param}`;
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
