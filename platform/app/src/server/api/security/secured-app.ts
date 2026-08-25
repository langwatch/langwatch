import { type Env, Hono, type MiddlewareHandler } from "hono";
import { mergePath } from "hono/utils/url";

import { appContextMiddleware } from "~/app/api/middleware/app-context";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
  canonicalAuthMiddleware,
  requirePermission,
} from "~/app/api/middleware/auth";
import { handleError } from "~/app/api/middleware/error-handler";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import {
  canonicalOrgAuthMiddleware,
  type OrgAuthMiddlewareVariables,
  orgAuthMiddleware,
  requireOrgPermission,
  requireProjectPermission,
} from "~/app/api/middleware/org-auth";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import {
  type ApiErrorEnvelope,
  canonicalErrorResponse,
} from "~/app/api/shared/canonical-error";
import { requireApiKeyPermission } from "~/server/api-key/auth-middleware";

import {
  type AccessPolicy,
  type CredentialClass,
  credentialClassFor,
} from "./access-policy";
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
   *
   * `errorEnvelope` is the family's published error shape: the chain refuses
   * requests itself, so it has to answer in the same shape the family's
   * handlers do.
   */
  chainFor(policy: AccessPolicy, errorEnvelope: ApiErrorEnvelope): MiddlewareHandler[];
}

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;
type HttpVerb = (typeof HTTP_VERBS)[number];

/**
 * Derive the family label (tracer span name + registry grouping) from the
 * basePath so it can never typo or drift from the mount path: `/api/agents`
 * becomes `agents`, `/api/gateway/v1` becomes `gateway-v1`.
 *
 * Exported because the management-service factory registers route policies
 * against the same registry: two derivations would let one family be labelled
 * two ways and split its authorization audit in half.
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

/**
 * The verb surface exposed by {@link SecuredApp.access}. Typed EXACTLY as the
 * underlying Hono instance's own verb methods, so validator inference
 * (`c.req.valid(...)`) and context typing (`c.get(...)`) are preserved
 * natively — that native inference is why the methods keep Hono's own return
 * type (`Hono<E>`) rather than `void`: collapsing the overloaded verb
 * signatures to strip the return would break `c.req.valid(...)`.
 *
 * The builder only controls HOW you reach these methods — you must first call
 * `.access(policy)`. A verb returns the raw `Hono<E>`, so chaining a second
 * verb onto it (`.access(p).get(...).post(...)`) would bypass the policy gate;
 * the route-registry introspection test is the backstop that fails CI if any
 * such unclassified route reaches the composed router. Always start each route
 * with a fresh `.access(...)`.
 */
export type SecuredVerbs<E extends Env> = Pick<Hono<E>, HttpVerb> & {
  /**
   * Register a HEAD route. Hono exposes no `.head` shortcut, so this routes
   * through `app.on("HEAD", ...)`; the call signature mirrors `.get`.
   */
  head: Hono<E>["get"];
  /**
   * Register an any-method route (Hono `app.all`), recorded in the registry
   * with method "ALL". Reserve for genuine multi-method endpoints such as
   * URL-rewrite shims; prefer a specific verb otherwise.
   */
  all: Hono<E>["all"];
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
  private readonly errorEnvelope: ApiErrorEnvelope;
  /**
   * The credential class the family publishes, when its scope's default would
   * name the wrong one. Only the instance-admin family needs it: a service app
   * enforces a shared secret, but that secret is a credential an operator
   * holds and the document declares a scheme for.
   */
  private readonly credentialClass?: CredentialClass;

  constructor(args: {
    basePath: string;
    strategy: AuthStrategy;
    errorEnvelope?: ApiErrorEnvelope;
    credentialClass?: CredentialClass;
  }) {
    this.basePath = args.basePath;
    this.family = familyFromBasePath(args.basePath);
    this.strategy = args.strategy;
    this.credentialClass = args.credentialClass;
    this.errorEnvelope = args.errorEnvelope ?? "legacy";
    this.hono = new Hono<E>().basePath(args.basePath);
    this.hono.use(tracerMiddleware({ name: this.family }));
    this.hono.use(loggerMiddleware());
    this.hono.use(appContextMiddleware);
    // One shape per family, whichever layer refuses. A family can still
    // install its own onError to name its domain errors more precisely.
    this.hono.onError(
      this.errorEnvelope === "canonical"
        ? (error, c) => canonicalErrorResponse(error, c)
        : handleError,
    );
  }

  /**
   * The credential class a route publishes.
   *
   * The app-level override renames only what the app's own secret classifies
   * as, so a `publicEndpoint` on the same app still publishes as `none`: the
   * SCIM discovery endpoints an identity provider reads before it holds a
   * token are not reached by that token, and saying they were would put a
   * security requirement on the one thing that has none.
   */
  private publishedCredentialClass(policy: AccessPolicy): CredentialClass {
    const derived = credentialClassFor({
      scope: this.strategy.scope,
      policy,
    });
    return derived === "internal" && this.credentialClass
      ? this.credentialClass
      : derived;
  }

  /**
   * The single entry point for registering routes. Returns the Hono verb
   * methods with the policy's enforcement chain prepended. The policy is a
   * required argument — there is no way to obtain the verb methods without it.
   */
  access(policy: AccessPolicy): SecuredVerbs<E> {
    // `public` and `handlerManaged` apply no builder chain: the route is either
    // intentionally open or authenticates inside its own handler.
    const chain =
      policy.kind === "public" || policy.kind === "handlerManaged"
        ? []
        : this.strategy.chainFor(policy, this.errorEnvelope);

    const bind = (method: HttpVerb | "head" | "all") => {
      return ((path: string, ...handlers: MiddlewareHandler[]) => {
        registerRoutePolicy({
          method: method.toUpperCase(),
          path: mergePath(this.basePath, path),
          policy,
          family: this.family,
          credentialClass: this.publishedCredentialClass(policy),
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
      all: bind("all"),
    };
  }

  /**
   * Mount another secured app under this one. Use for composing versioned
   * sub-apps. Routes mounted this way still carry their own declared policies
   * (recorded when they were built). Only a {@link SecuredApp} can be mounted —
   * a raw Hono would smuggle in routes with no declared policy, so wrap one in
   * a SecuredApp first if you must.
   */
  route(path: string, app: SecuredApp<Env>): this {
    this.hono.route(path, app.hono);
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
  chainFor(policy, errorEnvelope) {
    const auth = errorEnvelope === "canonical" ? canonicalAuthMiddleware : authMiddleware;
    switch (policy.kind) {
      case "permission":
        return [auth, requirePermission(policy.permission, errorEnvelope)];
      case "apiKeyPermission":
        // API-key ceiling: legacy project keys keep full access, scoped API
        // keys must hold the permission. `requireApiKeyPermission` reads the
        // resolved token the auth middleware set, so it runs after it.
        return [
          auth,
          requireApiKeyPermission({
            permission: policy.permission,
            errorEnvelope,
          }),
        ];
      case "anyAuthenticated":
        return [auth];
      default:
        return unsupported("project", policy);
    }
  },
};

const orgStrategy: AuthStrategy = {
  scope: "organization",
  chainFor(policy, errorEnvelope) {
    const auth =
      errorEnvelope === "canonical" ? canonicalOrgAuthMiddleware : orgAuthMiddleware;
    switch (policy.kind) {
      case "permission":
        return [auth, requireOrgPermission(policy.permission, errorEnvelope)];
      case "projectPermission":
        return [
          auth,
          requireProjectPermission({
            permission: policy.permission,
            param: policy.param,
            errorEnvelope,
          }),
        ];
      case "anyAuthenticated":
        return [auth];
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
 * project key / API key (the unified auth middleware) and authorizes `requires(...)`
 * against the caller's project-scoped role bindings — the Hono equivalent of
 * tRPC's `checkProjectPermission`.
 *
 * `Extra` widens the context Variables for apps that chain per-route middleware
 * which set additional context (e.g. a service middleware that sets
 * `c.var.modelProviderService`), so handlers keep full `c.get(...)` typing.
 */
export function createProjectApp<Extra extends object = Record<never, never>>(args: {
  basePath: string;
  /**
   * The error shape this family publishes. New families pass `canonical`;
   * the default keeps the families that predate the envelope answering
   * exactly what their consumers already parse.
   */
  errorEnvelope?: ApiErrorEnvelope;
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
  /**
   * The error shape this family publishes. New families pass `canonical`;
   * the default keeps the families that predate the envelope answering
   * exactly what their consumers already parse.
   */
  errorEnvelope?: ApiErrorEnvelope;
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
  verifySecret?: MiddlewareHandler;
  /**
   * The error shape this family publishes. New families pass `canonical`;
   * the default keeps the families that predate the envelope answering
   * exactly what their consumers already parse.
   */
  errorEnvelope?: ApiErrorEnvelope;
  /**
   * Overrides the credential class the family publishes. Set it only when the
   * secret is one an API client holds and the document declares a scheme for
   * it; leaving it unset keeps the honest default, `internal`, which the spec
   * generator refuses to advertise.
   */
  credentialClass?: CredentialClass;
}): SecuredApp<E> {
  const strategy: AuthStrategy = {
    scope: "service",
    chainFor(policy) {
      switch (policy.kind) {
        case "internal":
        case "anyAuthenticated":
          // A builder-applied secret check is only used when verifySecret is
          // provided. Legacy routes that validate the secret inside the handler
          // pass no verifySecret and still declare internalSecret(...) for the
          // registry; the chain is then empty.
          return args.verifySecret ? [args.verifySecret] : [];
        default:
          return unsupported("service", policy);
      }
    },
  };
  return new SecuredApp<E>({
    basePath: args.basePath,
    strategy,
    ...(args.errorEnvelope ? { errorEnvelope: args.errorEnvelope } : {}),
    ...(args.credentialClass ? { credentialClass: args.credentialClass } : {}),
  });
}
