import { Hono, type Env, type MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";

import {
  authMiddleware,
  requirePermission,
  type AuthMiddlewareVariables,
} from "~/app/api/middleware/auth";
import { handleError } from "~/app/api/middleware/error-handler";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import {
  orgAuthMiddleware,
  requireOrgPermission,
  type OrgAuthMiddlewareVariables,
} from "~/app/api/middleware/org-auth";
import { tracerMiddleware } from "~/app/api/middleware/tracer";

import type { AccessPolicy } from "./access-policy";
import { registerRoutePolicy } from "./route-registry";

/**
 * A strategy turns an {@link AccessPolicy} into the middleware chain that
 * authenticates the caller (for the strategy's scope) and authorizes the
 * requested permission. Strategies reuse the existing, battle-tested auth
 * middleware so there is exactly one implementation of each check.
 */
interface AuthStrategy {
  /** Scope name, used in error messages + registry entries. */
  readonly scope: "project" | "organization" | "service" | "session";
  /**
   * Build the middleware chain for a policy. `public` policies short-circuit to
   * an empty chain in {@link SecuredApp} before this is ever called.
   */
  chainFor(policy: AccessPolicy): MiddlewareHandler[];
}

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;
type HttpVerb = (typeof HTTP_VERBS)[number];

/**
 * Derive the family label (tracer span name + registry grouping) from the
 * basePath so it can never typo or drift from the mount path: `/api/agents`
 * becomes `agents`, `/api/gateway/v1` becomes `gateway-v1`.
 */
function familyFromBasePath(basePath: string): string {
  return (
    basePath
      .replace(/^\/+/, "")
      .replace(/^api\//, "")
      .replace(/\/+$/, "")
      .replace(/\//g, "-") || "api"
  );
}

/**
 * The verb surface exposed by {@link SecuredApp.access}. Typed EXACTLY as the
 * underlying Hono instance's own verb methods, so validator inference
 * (`c.req.valid(...)`) and context typing (`c.get(...)`) are preserved
 * natively. The builder only controls HOW you reach these methods — you must
 * first call `.access(policy)`.
 */
export type SecuredVerbs<E extends Env> = Pick<Hono<E>, HttpVerb> & {
  /**
   * Register a HEAD route. Hono exposes no `.head` shortcut, so this routes
   * through `app.on("HEAD", ...)`; the call signature mirrors `.get`.
   */
  head: Hono<E>["get"];
};

/**
 * A Hono application whose routes cannot be registered without first declaring
 * an {@link AccessPolicy}. The bare app deliberately does NOT expose
 * `.get/.post/...` — the only way to register a route is
 * `app.access(policy).get(path, ...handlers)`. Omitting the policy is a
 * compile-time error; bypassing the builder is caught by the router
 * introspection guard test against the route registry.
 */
export class SecuredApp<E extends Env> {
  /** The underlying Hono app — mount this in the API router via `api.route("/", app.hono)`. */
  readonly hono: Hono<E>;

  private readonly basePath: string;
  private readonly family: string;
  private readonly strategy: AuthStrategy;

  constructor(args: {
    basePath: string;
    strategy: AuthStrategy;
  }) {
    this.basePath = args.basePath;
    this.family = familyFromBasePath(args.basePath);
    this.strategy = args.strategy;
    this.hono = new Hono<E>().basePath(args.basePath);
    this.hono.use(tracerMiddleware({ name: this.family }));
    this.hono.use(loggerMiddleware());
    this.hono.onError(handleError);
  }

  /**
   * The single entry point for registering routes. Returns the Hono verb
   * methods with the policy's enforcement chain prepended. The policy is a
   * required argument — there is no way to obtain the verb methods without it.
   */
  access(policy: AccessPolicy): SecuredVerbs<E> {
    const chain = policy.kind === "public" ? [] : this.strategy.chainFor(policy);

    const bind = (method: HttpVerb | "head") => {
      return ((path: string, ...handlers: MiddlewareHandler[]) => {
        registerRoutePolicy({
          method: method.toUpperCase(),
          path: mergePath(this.basePath, path),
          policy,
          family: this.family,
        });
        // Prepend the enforcement chain, then the caller's handlers. The
        // verb method's STATIC type is Hono's own, so validator + context
        // inference is unaffected by this runtime prepend. HEAD has no Hono
        // shortcut, so it routes through `.on("HEAD", ...)`.
        if (method === "head") {
          const on = this.hono.on as unknown as (
            method: string,
            path: string,
            ...handlers: MiddlewareHandler[]
          ) => unknown;
          return on.call(this.hono, "HEAD", path, ...chain, ...handlers);
        }
        const verb = this.hono[method] as unknown as (
          path: string,
          ...handlers: MiddlewareHandler[]
        ) => unknown;
        return verb.call(this.hono, path, ...chain, ...handlers);
      }) as SecuredVerbs<E>[HttpVerb];
    };

    return {
      get: bind("get"),
      post: bind("post"),
      put: bind("put"),
      patch: bind("patch"),
      delete: bind("delete"),
      head: bind("head"),
    };
  }

  /**
   * Mount another secured app (or raw Hono) under this one. Use for composing
   * versioned sub-apps. Routes mounted this way still carry their own declared
   * policies (recorded when they were built).
   */
  route(path: string, app: SecuredApp<Env> | Hono<Env>): this {
    this.hono.route(path, app instanceof SecuredApp ? app.hono : app);
    return this;
  }

  /** App-level middleware (tracer/logger are already applied). Does not create routes. */
  use(...handlers: MiddlewareHandler[]): this {
    this.hono.use(...handlers);
    return this;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategies
// ─────────────────────────────────────────────────────────────────────────────

function unsupported(scope: string, policy: AccessPolicy): never {
  throw new Error(
    `Access policy "${policy.kind}" is not supported by ${scope}-scoped secured apps`,
  );
}

const projectStrategy: AuthStrategy = {
  scope: "project",
  chainFor(policy) {
    switch (policy.kind) {
      case "permission":
        return [authMiddleware, requirePermission(policy.permission)];
      case "anyAuthenticated":
        return [authMiddleware];
      default:
        return unsupported("project", policy);
    }
  },
};

const orgStrategy: AuthStrategy = {
  scope: "organization",
  chainFor(policy) {
    switch (policy.kind) {
      case "permission":
        return [orgAuthMiddleware, requireOrgPermission(policy.permission)];
      case "anyAuthenticated":
        return [orgAuthMiddleware];
      default:
        return unsupported("organization", policy);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Factories — the public surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A project-scoped secured app. Authenticates via project API key / legacy
 * project key / PAT (the unified auth middleware) and authorizes `requires(...)`
 * against the caller's project-scoped role bindings — the Hono equivalent of
 * tRPC's `checkProjectPermission`.
 *
 * `Extra` widens the context Variables for apps that chain per-route middleware
 * which set additional context (e.g. a service middleware that sets
 * `c.var.modelProviderService`), so handlers keep full `c.get(...)` typing.
 */
export function createProjectApp<Extra extends object = Record<never, never>>(args: {
  basePath: string;
}): SecuredApp<{ Variables: AuthMiddlewareVariables & Extra }> {
  return new SecuredApp({ ...args, strategy: projectStrategy });
}

/**
 * An organization-scoped secured app. Authenticates via an organization API key
 * and authorizes `requires(...)` against org-scoped role bindings — the Hono
 * equivalent of tRPC's `checkOrganizationPermission`.
 */
export function createOrgApp<Extra extends object = Record<never, never>>(args: {
  basePath: string;
}): SecuredApp<{ Variables: OrgAuthMiddlewareVariables & Extra }> {
  return new SecuredApp({ ...args, strategy: orgStrategy });
}

/**
 * A service-to-service secured app. Routes authenticate with a shared secret /
 * signature (verified by `verifySecret`) rather than an RBAC credential, so the
 * only valid policies are `internalSecret(reason)` and `publicEndpoint(reason)`.
 */
export function createServiceApp<E extends Env = Env>(args: {
  basePath: string;
  verifySecret: MiddlewareHandler;
}): SecuredApp<E> {
  const strategy: AuthStrategy = {
    scope: "service",
    chainFor(policy) {
      switch (policy.kind) {
        case "internal":
          return [args.verifySecret];
        case "anyAuthenticated":
          return [args.verifySecret];
        default:
          return unsupported("service", policy);
      }
    },
  };
  return new SecuredApp<E>({ basePath: args.basePath, strategy });
}
