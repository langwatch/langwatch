import type { Permission } from "~/server/api/rbac";

/**
 * The access decision for a single HTTP route. Every route mounted through the
 * secured app builder must declare exactly one of these — that is the whole
 * point: the access decision is a mandatory, reviewable property of the route,
 * not a positional middleware a developer can forget.
 *
 *   - permission       — the caller's credential must hold this RBAC permission
 *                        at the app's scope (project or organization).
 *   - apiKeyPermission — like `permission`, but enforced through the API-key
 *                        ceiling: legacy project API keys retain full access
 *                        while scoped API keys must hold the permission.
 *                        Use for the public REST surface (gateway-platform,
 *                        governance) so the registry records the real
 *                        permission instead of a blanket "any authenticated".
 *   - projectPermission — for org apps addressing one project: the permission
 *                        is resolved at the scope of the project named in the
 *                        route, not the organization. An org-wide grant still
 *                        passes (org bindings are ancestors of project scope);
 *                        a team- or project-scoped grant reaches only the
 *                        projects it was actually given.
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
  | { readonly kind: "apiKeyPermission"; readonly permission: Permission }
  | {
      readonly kind: "projectPermission";
      readonly permission: Permission;
      /** Route param naming the project. Defaults to `id`. */
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
      readonly permissions: readonly Permission[];
      /**
       * What kind of credential reaches this route:
       *
       *   apiKey   — a project/personal API key (what SDKs, the CLI and the
       *              Langy assistant carry)
       *   session  — a browser session cookie only
       *   both     — either is accepted
       *   internal — a shared secret or signature, not a user credential
       *
       * Mandatory for the same reason `permissions` is. It exists so that
       * "can an API key even reach this route?" is a property of the route
       * rather than a curated list of paths kept somewhere else — the audits
       * that need the answer were maintaining their own path lists, which
       * silently misclassify a route the moment one is added or renamed.
       */
      readonly credential: HandlerCredential;
    };

/** @see the `credential` field on the handler-managed policy. */
export type HandlerCredential = "apiKey" | "session" | "both" | "internal";

/**
 * Which credential an API consumer presents to reach a route.
 *
 * Narrower than {@link HandlerCredential}, and the difference is the point:
 * this answers "which key do I send", and the two API-key families are not
 * interchangeable. An organization key reaches organization routes and, with
 * `X-Project-Id`, project routes too; a project key can never reach an
 * organization route: `resolveOrgOnly` never resolves one, so authentication
 * fails before any permission is consulted and no grant on the key makes a
 * difference. Getting that wrong costs an afternoon, so it is a property of
 * the route rather than something to infer from the path.
 *
 * A route that also accepts a browser session still publishes its key class:
 * the session is not something an integrator can send.
 */
export type CredentialClass =
  | "project_api_key"
  | "organization_api_key"
  | "session"
  | "internal"
  | "none";

/**
 * The credential class a route reaches by, from the app it is mounted on and
 * the policy it declares.
 *
 * Derived rather than declared per route, because the app already decides it
 * for every route but one kind: a handler-managed route can opt out of its
 * app's family, and that is the only thing this has to read from the policy.
 *
 * Throws on the one pair that has no answer: a handler on a service app that
 * says it accepts an API key. A service app resolves neither a project nor an
 * organization, so there is no key family to name and any guess would be
 * published to integrators as fact. No route is written that way today, and
 * this is what keeps it that way.
 */
export function credentialClassFor({
  scope,
  policy,
}: {
  scope: "project" | "organization" | "service" | "session";
  policy: AccessPolicy;
}): CredentialClass {
  if (policy.kind === "public") return "none";
  if (policy.kind === "internal") return "internal";
  if (policy.kind === "handlerManaged") {
    if (policy.credential === "internal") return "internal";
    if (policy.credential === "session") return "session";
    // apiKey / both: the handler accepts a key, so the app's own family is
    // the answer, and the two scopes that have no family are refused below.
    if (scope === "service" || scope === "session") {
      throw new Error(
        `handlerManagedAuth({ credential: "${policy.credential}" }) on a ${scope} app has no API-key family: ` +
          "a service or session app resolves neither a project nor an organization, so nothing decides which " +
          "key reaches the route. Mount it on a project or organization app, or declare the credential the " +
          "handler really takes.",
      );
    }
  }
  switch (scope) {
    case "project":
      return "project_api_key";
    case "organization":
      return "organization_api_key";
    case "service":
      return "internal";
    case "session":
      return "session";
  }
}

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
 * keys); scoped API keys must satisfy `effective = ApiKey ∩ user` for
 * the permission at the project scope. This is the public REST surface's
 * equivalent of `requires(...)`, kept distinct so the registry records that
 * the gate is the API-key ceiling rather than a strict role check.
 */
export function apiKeyPermission(permission: Permission): AccessPolicy {
  return { kind: "apiKeyPermission", permission };
}

/**
 * Require an RBAC permission at the scope of the project the route addresses,
 * for org apps that operate on one project at a time. `requires(...)` would
 * resolve at organization scope there, so a single org-wide grant would reach
 * every project in the org.
 */
export function requiresOnProject(
  permission: Permission,
  options: { param?: string } = {},
): AccessPolicy {
  return {
    kind: "projectPermission",
    permission,
    param: options.param ?? "id",
  };
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
   *
   * REQUIRED, and that is the entire point. When it was optional, omitting it
   * and having nothing to declare were the same value, so a self-enforcing RBAC
   * route contributed nothing to the registry and every audit that reads the
   * registry walked straight past it. Writing `[]` is a claim; leaving it out
   * was an absence, and absence is what let `POST /api/experiments/:slug/run`
   * sit on a grain no least-privilege key could hold.
   */
  permissions: readonly Permission[];
}): AccessPolicy {
  assertReason(reason, "handlerManagedAuth");
  return { kind: "handlerManaged", reason, permissions, credential };
}

/**
 * Can a caller holding an API key reach this route at all?
 *
 * The question every "what can a key-bearing client do?" audit actually wants.
 * Non-handler-managed policies are reachable by key: the secured-app builder
 * authenticates them by key or session alike.
 */
export function isApiKeyReachable(policy: AccessPolicy): boolean {
  if (policy.kind === "handlerManaged") {
    return policy.credential === "apiKey" || policy.credential === "both";
  }
  return policy.kind !== "public" && policy.kind !== "internal";
}

/**
 * Every RBAC permission a route requires, whichever way it declares it —
 * middleware policy or self-enforcing handler. The single place any audit
 * should ask "what does this route actually demand?", so a new policy kind
 * cannot quietly drop out of the answer.
 */
export function policyPermissions(policy: AccessPolicy): readonly Permission[] {
  switch (policy.kind) {
    case "permission":
    case "apiKeyPermission":
    case "projectPermission":
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
