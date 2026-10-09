import type { AccessPolicy, CredentialClass } from "./access-policy.ts";
import type { Credential } from "./access/access.ts";
import type { RestSharedPath } from "./rest/declaration.ts";

// The process-wide route-policy registry, populated as each family mounts. The
// router-introspection guard cross-checks the composed router against it, so any mounted
// route lacking a declared policy — even one that bypassed the runtime — fails CI.

export interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
  readonly policy: AccessPolicy;
  readonly family: string;
  /**
   * Which credential an API consumer sends here. Derived by the runtime from the mount and
   * the route, so a route cannot claim a credential class nothing enforces. Read by the
   * OpenAPI generator to stamp each operation's `security`.
   */
  readonly credentialClass: CredentialClass;
  /**
   * The credential KIND the route answers behind: the door it names, or its
   * family's own. The address inventory is keyed on this, so a conversion that
   * changes which door serves a path is a failing diff.
   */
  readonly credential: Credential;
  /**
   * The `/api/v1` path this same route also answers at. One logical route with
   * two addresses, so an authorization audit and the document's drift guard
   * count it once and still recognise the canonical published URL.
   */
  readonly canonicalPath?: string;
  /**
   * True when this mount answers 410 Gone for a withdrawn endpoint. No handler
   * stands behind it, so the route-coverage gate accounts for it by shape.
   */
  readonly withdrawn?: boolean;
  /**
   * True for the catch-alls that 404 an unknown version namespace. Real routes
   * in the table, and undocumentable for the same reason a tombstone is.
   */
  readonly isNamespaceGuard?: boolean;
  /**
   * Present when the path sits in another module's namespace for the migration (§8, R10):
   * the owner, the module serving it, why, and the plan that retires it.
   */
  readonly sharedPath?: RegisteredSharedPath;
  /** Every route serves while the installation upgrades; this one holds, and says why (API-UP). */
  readonly holdsWhileUpgrading?: UpgradeHoldReason;
}

/** Why a route cannot serve until the ledger is current: what it would get wrong mid-upgrade. */
export type UpgradeHoldReason = Readonly<{ because: string }>;

/** A hold names what the route would get wrong mid-upgrade; a blank reason is refused. */
export function assertHoldReason({
  address,
  reason,
}: {
  address: string;
  reason: UpgradeHoldReason;
}): void {
  if (reason.because.trim() !== "") return;
  throw new Error(`${address} holds while upgrading without saying why: name it in \`because\``);
}

export type RegisteredSharedPath = RestSharedPath & Readonly<{ servedBy: string }>;

const registry = new Map<string, RegisteredRoute>();

function registryKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Record (or overwrite, idempotently) the policy for a (method, path). */
export function registerRoutePolicy(route: RegisteredRoute): void {
  registry.set(registryKey(route.method, route.path), {
    ...route,
    method: route.method.toUpperCase(),
  });
}

export function getRoutePolicy(method: string, path: string): RegisteredRoute | undefined {
  return registry.get(registryKey(method, path));
}

export function allRegisteredRoutes(): RegisteredRoute[] {
  return [...registry.values()];
}

/**
 * Every route declared to hold while upgrading, as a regex over `METHOD /path` the liveness door
 * matches before it proxies; every other route serves (API-UP default-on). A held wildcard skips
 * the literal routes beneath it that do not hold themselves. Spec: in-app-upgrade.feature.
 */
export function routesHeldWhileUpgrading(): string[] {
  const routes = allRegisteredRoutes();
  const serving = routes.filter((route) => !route.holdsWhileUpgrading).flatMap(addressesOf);
  const rest = routes
    .filter((route) => route.holdsWhileUpgrading)
    .flatMap(addressesOf)
    .map(({ method, path }) => {
      const pattern = `${method} ${pathPattern(path)}`;
      if (!path.includes("*")) return `^${pattern}$`;
      const beneath = new RegExp(`^${pattern}$`);
      const skipped = serving
        .filter((other) => !other.path.includes("*") && beneath.test(`${other.verb} ${other.path}`))
        .map((other) => `(?!${other.method} ${pathPattern(other.path)}$)`);
      return `^${skipped.join("")}${pattern}$`;
    });
  return trpcHeldWhileUpgrading.size === 0 ? rest : [...rest, ...trpcHeldPatterns()];
}

/** A route's bare and twin paths, each with its method as a regex and as declared. */
function addressesOf(route: RegisteredRoute): { method: string; verb: string; path: string }[] {
  const method = route.method === "ALL" ? "[A-Z]+" : route.method;
  const paths = [route.path, ...(route.canonicalPath ? [route.canonicalPath] : [])];
  return paths.map((path) => ({ method, verb: route.method, path }));
}

const trpcHeldWhileUpgrading = new Set<string>();

/** A tRPC procedure (`namespace.name`) declared to hold while upgrading. */
export function registerTrpcHeldWhileUpgrading(procedure: string): void {
  trpcHeldWhileUpgrading.add(procedure);
}

/** A tRPC batch (TrpcHost.path) holds when any procedure in it holds; a subscription on SSE too. */
function trpcHeldPatterns(): string[] {
  const procedures = [...trpcHeldWhileUpgrading];
  const one = `(?:${procedures.map(escapeRegex).join("|")})`;
  const stream = `(?:${procedures.map((name) => name.split(".").map(escapeRegex).join("[./]")).join("|")})`;
  return [`^(?:GET|POST) /api/trpc/(?:[^/]*,)?${one}(?:,[^/]*)?$`, `^GET /api/sse/${stream}$`];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A Hono path as a regex: `:name` one segment, `:name{re}` its own pattern, `*` the rest. */
function pathPattern(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (segment === "*") return ".*";
      const param = /^:\w+(?:\{(.+)\})?\??$/.exec(segment);
      if (param) return `(?:${param[1] ?? "[^/]+"})`;
      return escapeRegex(segment);
    })
    .join("/");
}
