import type { Env, ErrorHandler, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { mergePath } from "hono/utils/url";
import type { AuthzPermission } from "@langwatch/authz-contract";

import {
  type AccessPolicy,
  type CredentialClass,
  credentialClassFor,
} from "./access-policy.js";
import { registerRoutePolicy } from "./route-registry.js";

/**
 * Which error shape a route family publishes.
 *
 * `canonical` is what new families use. `legacy` is the flat
 * `{ error: "<sentence>", message? }` the families that predate the envelope
 * already published, and which their consumers parse; it stays until a family
 * migrates on purpose, because the shape is part of its contract.
 *
 * The package names the two shapes because the builder has to choose between
 * them — which `onError` a family installs, and which refusal body its auth
 * chain answers with — but it renders neither. Both are supplied as ports.
 */
export type ApiErrorEnvelope = "legacy" | "canonical";

/**
 * Everything the builder needs from the process it runs in.
 *
 * The spine decides WHICH checks a route gets and records that decision in the
 * route registry; it performs none of them. Authentication reads API keys,
 * sessions and role bindings out of a database, and error rendering reads the
 * application's own error taxonomy — neither belongs in a transport package,
 * and dragging either in would put Prisma behind `@langwatch/api`.
 *
 * A process supplies these once, through {@link createSecuritySpine}, and gets
 * the three app factories back already bound to them. That is deliberately the
 * only way to obtain them: a spine that could be built before its ports were
 * installed would silently produce apps with empty enforcement chains, which is
 * the one failure this whole mechanism exists to make impossible.
 */
export interface SecuredAppPorts {
  /**
   * Installs the process's application container on the request context.
   * Every family mounts it, so no middleware or handler resolves a singleton.
   */
  readonly appContext: MiddlewareHandler;
  /** The request logger, one instance per family. */
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
   * RBAC check at the scope of the project named in the route, for org apps
   * addressing one project at a time.
   */
  readonly authorizeRouteProjectPermission: (args: {
    permission: AuthzPermission;
    param: string;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;
}

/**
 * A strategy turns an {@link AccessPolicy} into the middleware chain that
 * authenticates the caller (for the strategy's scope) and authorizes the
 * requested permission. Strategies delegate to the process's own auth
 * middleware through {@link SecuredAppPorts} so there is exactly one
 * implementation of each check.
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
    ports: SecuredAppPorts;
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
    this.hono.use(args.ports.requestTracer({ name: this.family }));
    this.hono.use(args.ports.requestLogger());
    this.hono.use(args.ports.appContext);
    // One shape per family, whichever layer refuses. A family can still
    // install its own onError to name its domain errors more precisely.
    this.hono.onError(
      this.errorEnvelope === "canonical"
        ? args.ports.canonicalErrorHandler
        : args.ports.legacyErrorHandler,
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

function projectStrategy(ports: SecuredAppPorts): AuthStrategy {
  return {
    scope: "project",
    chainFor(policy, envelope) {
      const auth = ports.authenticateProject(envelope);
      switch (policy.kind) {
        case "permission":
          return [
            auth,
            ports.authorizeProjectPermission({
              permission: policy.permission,
              envelope,
            }),
          ];
        case "apiKeyPermission":
          // API-key ceiling: legacy project keys keep full access, scoped API
          // keys must hold the permission. The ceiling reads the resolved
          // token the auth middleware set, so it runs after it.
          return [
            auth,
            ports.authorizeApiKeyCeiling({
              permission: policy.permission,
              envelope,
            }),
          ];
        case "anyAuthenticated":
          return [auth];
        default:
          return unsupported("project", policy);
      }
    },
  };
}

function orgStrategy(ports: SecuredAppPorts): AuthStrategy {
  return {
    scope: "organization",
    chainFor(policy, envelope) {
      const auth = ports.authenticateOrganization(envelope);
      switch (policy.kind) {
        case "permission":
          return [
            auth,
            ports.authorizeOrganizationPermission({
              permission: policy.permission,
              envelope,
            }),
          ];
        case "projectPermission":
          return [
            auth,
            ports.authorizeRouteProjectPermission({
              permission: policy.permission,
              param: policy.param,
              envelope,
            }),
          ];
        case "anyAuthenticated":
          return [auth];
        default:
          return unsupported("organization", policy);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Factories — the public surface
// ─────────────────────────────────────────────────────────────────────────────

/** Arguments common to every secured app factory. */
interface SecuredAppArgs {
  basePath: string;
  /**
   * The error shape this family publishes. New families pass `canonical`;
   * the default keeps the families that predate the envelope answering
   * exactly what their consumers already parse.
   */
  errorEnvelope?: ApiErrorEnvelope;
}

/**
 * The three app factories a process gets back once it has supplied its ports.
 *
 * `ProjectVariables` and `OrganizationVariables` are the context shapes the
 * process's own authentication middleware sets — the resolved project and
 * organization rows. The package never names those types: it only guarantees
 * that a handler on a project app sees whatever `authenticateProject` put
 * there, plus whatever per-route middleware the family chains on top.
 */
export interface SecuritySpine<
  ProjectVariables extends object,
  OrganizationVariables extends object,
> {
  /**
   * A project-scoped secured app. Authenticates via project API key / legacy
   * project key / browser session (the process's unified auth middleware) and
   * authorizes `requires(...)` against the caller's project-scoped role
   * bindings — the Hono equivalent of tRPC's `checkProjectPermission`.
   *
   * `Extra` widens the context Variables for apps that chain per-route
   * middleware which set additional context (e.g. a service middleware that
   * sets `c.var.modelProviderService`), so handlers keep full `c.get(...)`
   * typing.
   */
  createProjectApp<Extra extends object = Record<never, never>>(
    args: SecuredAppArgs,
  ): SecuredApp<{ Variables: ProjectVariables & Extra }>;

  /**
   * An organization-scoped secured app. Authenticates via an organization API
   * key and authorizes `requires(...)` against org-scoped role bindings — the
   * Hono equivalent of tRPC's `checkOrganizationPermission`.
   */
  createOrgApp<Extra extends object = Record<never, never>>(
    args: SecuredAppArgs,
  ): SecuredApp<{ Variables: OrganizationVariables & Extra }>;

  /**
   * A service-to-service secured app. Routes authenticate with a shared secret
   * / signature (verified by `verifySecret`) rather than an RBAC credential, so
   * the only valid policies are `internalSecret(reason)` and
   * `publicEndpoint(reason)`.
   */
  createServiceApp<E extends Env = Env>(
    args: SecuredAppArgs & {
      verifySecret?: MiddlewareHandler;
      /**
       * Overrides the credential class the family publishes. Set it only when
       * the secret is one an API client holds and the document declares a
       * scheme for it; leaving it unset keeps the honest default, `internal`,
       * which the spec generator refuses to advertise.
       */
      credentialClass?: CredentialClass;
    },
  ): SecuredApp<E>;
}

/**
 * Bind the secured-app builder to one process's authentication, logging,
 * tracing and error rendering.
 *
 * Call it once, at composition time, and export the three factories it returns.
 * They are the only way to build a `SecuredApp`, which is what guarantees no
 * route family can be constructed before the checks it declares exist.
 */
export function createSecuritySpine<
  ProjectVariables extends object,
  OrganizationVariables extends object,
>(ports: SecuredAppPorts): SecuritySpine<ProjectVariables, OrganizationVariables> {
  const project = projectStrategy(ports);
  const organization = orgStrategy(ports);

  return {
    createProjectApp<Extra extends object = Record<never, never>>(
      args: SecuredAppArgs,
    ): SecuredApp<{ Variables: ProjectVariables & Extra }> {
      return new SecuredApp({ ...args, ports, strategy: project });
    },

    createOrgApp<Extra extends object = Record<never, never>>(
      args: SecuredAppArgs,
    ): SecuredApp<{ Variables: OrganizationVariables & Extra }> {
      return new SecuredApp({ ...args, ports, strategy: organization });
    },

    createServiceApp<E extends Env = Env>(
      args: SecuredAppArgs & {
        verifySecret?: MiddlewareHandler;
        credentialClass?: CredentialClass;
      },
    ): SecuredApp<E> {
      const strategy: AuthStrategy = {
        scope: "service",
        chainFor(policy) {
          switch (policy.kind) {
            case "internal":
            case "anyAuthenticated":
              // A builder-applied secret check is only used when verifySecret
              // is provided. Legacy routes that validate the secret inside the
              // handler pass no verifySecret and still declare
              // internalSecret(...) for the registry; the chain is then empty.
              return args.verifySecret ? [args.verifySecret] : [];
            default:
              return unsupported("service", policy);
          }
        },
      };
      return new SecuredApp<E>({
        basePath: args.basePath,
        ports,
        strategy,
        ...(args.errorEnvelope ? { errorEnvelope: args.errorEnvelope } : {}),
        ...(args.credentialClass ? { credentialClass: args.credentialClass } : {}),
      });
    },
  };
}
