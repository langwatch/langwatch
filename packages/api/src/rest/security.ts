/**
 * The process security kernel a REST door composes: the ports one process fills
 * for its own doors, the cross-check that every mounted route declared a
 * policy, the fingerprint a credential refusal is logged with, the one
 * shared-secret comparison, the management surface's audit emission, and the
 * permission vocabulary custom roles are built from.
 */
import { timingSafeEqual } from "node:crypto";

import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Context, ErrorHandler, Hono, MiddlewareHandler } from "hono";

import type { IdempotentRunner } from "./request.ts";
import type { RegisteredRoute } from "./runtime.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Everything a REST door needs from the process it runs in.
//
// Authentication reads API keys, sessions and role bindings out of a database,
// and the two error envelopes are rendered by the application's own error
// taxonomy. Neither belongs in a transport package, and neither can be resolved
// here: the process that owns those substrates supplies them once.
// ─────────────────────────────────────────────────────────────────────────────

/** Which error shape a route family publishes. */
export type ApiErrorEnvelope = "legacy" | "canonical";

export interface RestApiServicePorts {
  /**
   * Installs the process's application container on the request context.
   * Every family mounts it, so no middleware or handler resolves a singleton.
   */
  readonly appContext: MiddlewareHandler;
  /**
   * The request logger, mounted by every family. It writes ONE record per
   * request whichever family's instance runs first, so a request through the
   * twenty-one families sharing `/api` is still one line.
   */
  readonly requestLogger: () => MiddlewareHandler;
  /** The server-span tracer, named for the family it wraps. */
  readonly requestTracer: (options: { name: string }) => MiddlewareHandler;
  /** `onError` for a family publishing the flat legacy body. */
  readonly legacyErrorHandler: ErrorHandler;
  /** `onError` for a family publishing the canonical envelope. */
  readonly canonicalErrorHandler: ErrorHandler;

  /** Project-scope authentication (API key, legacy project key, or session). */
  readonly authenticateProject: (envelope: ApiErrorEnvelope) => MiddlewareHandler;
  /** Project-scope RBAC check against the caller's role bindings. */
  readonly authorizeProjectPermission: (args: {
    permission: AuthzPermission;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;
  /**
   * The API-key ceiling: legacy project keys keep full access, scoped API keys
   * must hold the permission. Runs after {@link authenticateProject}, which is
   * what resolves the token it reads.
   */
  readonly authorizeApiKeyCeiling: (args: {
    permission: AuthzPermission;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;

  /** Organization-scope authentication (organization API key). */
  readonly authenticateOrganization: (envelope: ApiErrorEnvelope) => MiddlewareHandler;
  /** Organization-scope RBAC check against the caller's org role bindings. */
  readonly authorizeOrganizationPermission: (args: {
    permission: AuthzPermission;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;
  /**
   * RBAC check at the scope of the project named in the route, for org doors
   * addressing one project at a time.
   */
  readonly authorizeRouteProjectPermission: (args: {
    permission: AuthzPermission;
    param: string;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;
  /**
   * RBAC check at the scope of the team named in the route, for org doors
   * addressing one team at a time.
   */
  readonly authorizeRouteTeamPermission: (args: {
    permission: AuthzPermission;
    param: string;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;

  /**
   * The receipt ledger backing a replayable create. Supplied ONCE by the
   * process, which is what owns the database and the encryption key a receipt
   * lives in.
   */
  readonly idempotency?: IdempotentRunner;
  /** Organization-scope authentication in THROWING mode. */
  readonly authenticateOrganizationThrowing: MiddlewareHandler;
  /** Organization-scope RBAC check that throws rather than answering. */
  readonly authorizeOrganizationPermissionThrowing: (
    permission: AuthzPermission,
  ) => MiddlewareHandler;
}

/** @see RestApiServicePorts — the same contract, named for the composition. */
export type AppRestSecurityPorts = RestApiServicePorts;

/**
 * Derive the family label (tracer span name + registry grouping) from the
 * basePath so it can never typo or drift from the mount path: `/api/agents`
 * becomes `agents`, `/api/gateway/v1` becomes `gateway-v1`.
 */
export function familyFromBasePath(basePath: string): string {
  return (
    basePath
      .replace(/^\/+/, "")
      .replace(/^api\//, "")
      .replace(/\/+$/, "")
      .replace(/\//g, "-") || "api"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The cross-check: no route reaches the router unclassified.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The mounted route table a composed app publishes. Hono's own `routes` array,
 * named here so the assertion reads any app-shaped value without depending on
 * the generic parameters a family happens to carry.
 */
export type MountedRouteTable = Readonly<{
  routes: ReadonlyArray<{ method: string; path: string }>;
}>;

/**
 * A method-"ALL" route on a wildcard path is app-level middleware, a sub-app
 * mount, or a catch-all that terminates the request inside its own framework.
 * None is an enumerable endpoint, so neither side of the cross-check counts it.
 */
function isUnenumerableMount(method: string, path: string): boolean {
  return method.toUpperCase() === "ALL" && path.includes("*");
}

/**
 * Every address a registered route answers at: its own path and, when it has
 * one, the canonical `/api/v1` twin the runtime recorded alongside it.
 */
function registeredAddresses(registry: readonly RegisteredRoute[]): Set<string> {
  const addresses = new Set<string>();
  for (const route of registry) {
    addresses.add(`${route.method.toUpperCase()} ${route.path}`);
    if (route.canonicalPath) {
      addresses.add(`${route.method.toUpperCase()} ${route.canonicalPath}`);
    }
  }
  return addresses;
}

/** Every mounted endpoint with no entry in the route registry, sorted. */
export function undeclaredRoutes(options: {
  app: MountedRouteTable | Hono<any, any, any>;
  registry: readonly RegisteredRoute[];
}): string[] {
  const declared = registeredAddresses(options.registry);
  const undeclared = new Set<string>();
  for (const route of options.app.routes) {
    if (isUnenumerableMount(route.method, route.path)) continue;
    const address = `${route.method.toUpperCase()} ${route.path}`;
    if (!declared.has(address)) undeclared.add(address);
  }
  return [...undeclared].sort();
}

/**
 * Refuses to finish booting while the process serves a route no access policy
 * covers — the mount-time twin of the type error and the runtime's own throw.
 * A plain `Error`: a wiring defect of ours, not one a caller can act on.
 */
export function assertEveryRouteDeclared(options: {
  app: MountedRouteTable | Hono<any, any, any>;
  registry: readonly RegisteredRoute[];
}): void {
  const undeclared = undeclaredRoutes(options);
  if (undeclared.length === 0) return;
  throw new Error(
    `REST routes mounted with no declared access policy: ${undeclared.join(", ")}. ` +
      "Declare them with defineRestRouter and mount them on the process's REST runtime. " +
      "There is no allowlist.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The fingerprint every credential refusal on this boundary is logged with.
//
// A 401 on an ingestion hot path is reported by the customer as "my SDK stopped
// working", and the one thing on-call needs is which caller and which SDK. None
// of these fields is a credential: the token never appears, only the shape of
// the request that carried it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `hasEmptyAuthToken` distinguishes "X-Auth-Token sent as an empty string" — a
 * customer-side environment misconfiguration, where an SDK with an empty
 * `api_key` still serialises the header — from "no auth header at all", which
 * is a misconfigured SDK or an unauthenticated probe. Both answer the same 401;
 * the log line is the only place they are told apart.
 */
export type AuthDiagnostics = {
  path: string;
  method: string;
  userAgent: string | null;
  traceparent: string | null;
  forwardedFor: string | null;
  hasEmptyAuthToken: boolean;
};

export function collectAuthDiagnostics(request: {
  path: string;
  method: string;
  header: (name: string) => string | undefined;
}): AuthDiagnostics {
  const get = (name: string) => request.header(name) ?? null;
  const xAuthToken = request.header("x-auth-token");
  return {
    path: request.path,
    method: request.method,
    userAgent: get("user-agent"),
    traceparent: get("traceparent"),
    forwardedFor: get("x-forwarded-for") ?? get("x-real-ip"),
    hasEmptyAuthToken: xAuthToken !== undefined && xAuthToken === "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The one comparison behind every internal route's shared secret.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fails CLOSED, because `header === secret` read `undefined === undefined` as
 * true and let anyone trigger destructive jobs.
 */
export function isInternalSecretValid({
  authorizationHeader,
  expected,
}: {
  authorizationHeader: string | undefined;
  expected: string | undefined;
}): boolean {
  if (!expected) return false;

  const presented = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : authorizationHeader;
  if (!presented) return false;

  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit emission for management API writes, as a port.
//
// The write has already committed by the time this is called, so a logging
// failure must not fail the response — the port returns `void` rather than a
// promise on purpose, and the process that supplies it owns the swallow.
// ─────────────────────────────────────────────────────────────────────────────

/** Action names follow `management.<resource>.<verb>`. */
export type AppRestManagementAuditPort = (entry: {
  /** {@link managementActor}: the member, or the credential acting as nobody. */
  userId: string;
  organizationId: string;
  action: `management.${string}.${string}`;
  args?: Record<string, unknown>;
}) => void;

/**
 * The audit actor behind an org-authenticated management request.
 *
 * The user the credential acts as; a service key acts as nobody, so it is
 * recorded as `apikey:<id>`, still one stable string per credential, so an
 * audit reader can group a provisioning run's writes.
 */
export function managementActor(c: Context): string {
  const userId = c.get("apiKeyUserId") as string | null | undefined;
  if (userId) return userId;
  return `apikey:${c.get("apiKeyId") as string}`;
}

/** {@link managementActor}, already applied, for a family's one-line call sites. */
export function emitManagementAudit({
  c,
  audit,
  organizationId,
  action,
  args,
}: {
  c: Context;
  audit: AppRestManagementAuditPort;
  organizationId: string;
  action: `management.${string}.${string}`;
  args?: Record<string, unknown>;
}): void {
  audit({
    userId: managementActor(c),
    organizationId,
    action,
    ...(args === undefined ? {} : { args }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The permission vocabulary custom roles are built from, as a port.
//
// The catalogue itself is application data — the resource and action lists the
// settings UI, the RBAC resolver and the custom-role validator all read. A
// transport package that imported it would drag the whole RBAC tree behind
// `@langwatch/api`, so the process hands the three facts over instead.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both lists arrive in the order the process states them, and the published
 * catalogue preserves it: a caller that renders a permission picker from this
 * document sees the same order the settings UI does.
 */
export interface AppRestRbacVocabulary {
  /** Every action a permission may name, e.g. `view`, `manage`. */
  readonly actions: readonly string[];
  /** Every resource a permission may name, e.g. `organization`, `traces`. */
  readonly resources: readonly string[];
  /**
   * Whether the resource only takes effect at organization scope (ADR-021), so
   * a custom role listing one of its permissions cannot be bound at team or
   * project scope.
   */
  isOrganizationExclusive(resource: string): boolean;
}
