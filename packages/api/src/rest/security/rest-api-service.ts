import type { Env, ErrorHandler, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { mergePath } from "hono/utils/url";
import type { AuthzPermission } from "@langwatch/authz-contract";

import {
  type AccessPolicy,
  type CredentialClass,
  credentialClassFor,
  publicEndpoint,
  requires,
} from "../../access-policy.js";
import { createService, type ServiceBuilder } from "../builder.js";
import type { RouteChain } from "../definition.js";
import {
  ENDPOINT_ROUTE,
  REQUEST_FAMILY,
  type EndpointVariables,
  type MountedRoute,
} from "../types.js";
import { canonicalV1Path, undescribedStack } from "../v1-alias.js";
import { registerRoutePolicy } from "./route-registry.js";

/**
 * Which error shape a route family publishes.
 */
export type ApiErrorEnvelope = "legacy" | "canonical";

/**
 * Everything the builder needs from the process it runs in.
 */
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
   * RBAC check at the scope of the project named in the route, for org apps
   * addressing one project at a time.
   */
  readonly authorizeRouteProjectPermission: (args: {
    permission: AuthzPermission;
    param: string;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;
  /**
   * RBAC check at the scope of the team named in the route, for org apps
   * addressing one team at a time.
   */
  readonly authorizeRouteTeamPermission: (args: {
    permission: AuthzPermission;
    param: string;
    envelope: ApiErrorEnvelope;
  }) => MiddlewareHandler;

  /**
   * Organization-scope authentication in THROWING mode, for the versioned
   * families {@link RestApiService.createVersionedApp} builds.
   */
  readonly authenticateOrganizationThrowing: MiddlewareHandler;
  /** Organization-scope RBAC check that throws rather than answering. */
  readonly authorizeOrganizationPermissionThrowing: (
    permission: AuthzPermission,
  ) => MiddlewareHandler;
}

/**
 * A strategy turns an {@link AccessPolicy} into the middleware chain that authenticates the caller (for the
 * strategy's scope) and authorizes the requested permission. Strategies delegate to the process's own auth
 * middleware through {@link RestApiServicePorts} so there is exactly one implementation of each check.
 */
interface AuthStrategy {
  /** Scope name, used in error messages + registry entries. */
  readonly scope: "project" | "organization" | "service" | "session";
  /**
   * Build the middleware chain for a policy. `public` policies short-circuit to
   * an empty chain in {@link SecuredApp} before this is ever called.
   */
  chainFor(policy: AccessPolicy, errorEnvelope: ApiErrorEnvelope): MiddlewareHandler[];
}

const HTTP_VERBS = ["get", "post", "put", "patch", "delete"] as const;
type HttpVerb = (typeof HTTP_VERBS)[number];

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

/**
 * The verb surface exposed by {@link SecuredApp.access}. Typed EXACTLY as the underlying Hono instance's own verb methods, so validator inference
 * (`c.req.valid(...)`) and context typing (`c.get(...)`) are preserved natively — that native inference is why the methods keep Hono's own return type
 * (`Hono<E>`) rather than `void`: collapsing the overloaded verb signatures to strip the return would break `c.req.valid(...)`.
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
 * A Hono application whose routes cannot be registered without first declaring an {@link AccessPolicy}. The bare app deliberately does NOT
 * expose `.get/.post/...` — the only way to register a route is `app.access(policy).get(path, ...handlers)`. Omitting the policy is a
 * compile-time error; bypassing the builder is caught by the router introspection guard test against the route registry.
 */
export class SecuredApp<E extends Env> {
  /** The underlying Hono app — mount this in the API router via `api.route("/", app.hono)`. */
  readonly hono: Hono<E>;

  private readonly basePath: string;
  /** Whether this family publishes `/api/v1` twins of its routes. */
  private readonly v1Alias: boolean;
  /**
   * The `/api/v1` scope its app-level middleware needs, or null. A family
   * based at `/api` needs none: `/api/*` already covers `/api/v1/*`.
   */
  private readonly v1BasePath: string | null;
  private readonly family: string;
  private readonly strategy: AuthStrategy;
  private readonly errorEnvelope: ApiErrorEnvelope;
  /**
   * The credential class the family publishes, when its scope's default would name the wrong one. Only
   * the instance-admin family needs it: a service app enforces a shared secret, but that secret is a
   * credential an operator holds and the document declares a scheme for.
   */
  private readonly credentialClass?: CredentialClass;

  constructor(args: {
    basePath: string;
    ports: RestApiServicePorts;
    strategy: AuthStrategy;
    errorEnvelope?: ApiErrorEnvelope;
    credentialClass?: CredentialClass;
    v1Alias?: boolean;
  }) {
    this.basePath = args.basePath;
    this.v1Alias = args.v1Alias !== false;
    this.v1BasePath = this.v1Alias ? canonicalV1Path(args.basePath) : null;
    this.family = familyFromBasePath(args.basePath);
    this.strategy = args.strategy;
    this.credentialClass = args.credentialClass;
    this.errorEnvelope = args.errorEnvelope ?? "legacy";
    // No Hono base path: the family registers absolute paths itself, because
    // its routes answer under two prefixes and `basePath()` admits only one.
    this.hono = new Hono<E>();
    this.scoped(
      args.ports.requestTracer({ name: this.family }),
      args.ports.requestLogger(),
      args.ports.appContext,
    );
    // One shape per family, whichever layer refuses. A family can still
    // install its own onError to name its domain errors more precisely.
    this.hono.onError(
      this.errorEnvelope === "canonical"
        ? args.ports.canonicalErrorHandler
        : args.ports.legacyErrorHandler,
    );
  }

  /**
   * App-level middleware, mounted once per prefix the family answers under.
   * `/api` families need no v1 scope: `/api/*` already covers `/api/v1/*`.
   */
  private scoped(...handlers: MiddlewareHandler[]): void {
    this.hono.use(`${this.basePath}/*`, ...handlers);
    if (this.v1BasePath) {
      this.hono.use(`${this.v1BasePath}/*`, ...handlers);
    }
  }

  /**
   * The credential class a route publishes.
   */
  private publishedCredentialClass(policy: AccessPolicy): CredentialClass {
    const derived = credentialClassFor({
      scope: this.strategy.scope,
      policy,
    });
    return derived === "internal" && this.credentialClass ? this.credentialClass : derived;
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
        const registeredPath = mergePath(this.basePath, path);
        const aliasPath = this.v1Alias ? canonicalV1Path(registeredPath) : null;
        registerRoutePolicy({
          method: method.toUpperCase(),
          path: registeredPath,
          policy,
          family: this.family,
          credentialClass: this.publishedCredentialClass(policy),
          ...(aliasPath ? { canonicalPath: aliasPath } : {}),
        });
        // Prepend the enforcement chain, then the caller's handlers. The verb method's STATIC type is Hono's own, so validator + context inference is unaffected by this
        // runtime prepend. HEAD has no Hono shortcut, and `.on("HEAD", …)` does not give it one: Hono answers HEAD BEFORE routing, by re-dispatching the same request as
        // GET and returning `new Response(null, thatResponse)` (hono-base.js `#dispatch`). Nothing HEAD-shaped is ever matched, so the handler registered here CANNOT RUN
        // — a path that also has a GET is served by that GET with the body dropped, and a path that does not 404s. The registration is kept because the policy it records
        // is what `generateOpenAPISpec` reads; the handler is decoration. Asserted both ways in rest-api-service.unit.test.ts.
        const stack = [this.stampRoute(method, registeredPath), ...chain, ...handlers];
        // The v1 twin: same stack, same policy, one logical route. Its copy
        // carries no OpenAPI metadata, so the describer publishes the bare
        // path once instead of the same operation twice.
        if (aliasPath) {
          const on = this.hono.on as unknown as (
            method: string,
            path: string,
            ...handlers: MiddlewareHandler[]
          ) => unknown;
          on.call(
            this.hono,
            method === "all" ? "ALL" : method.toUpperCase(),
            aliasPath,
            ...undescribedStack(stack),
          );
        }
        if (method === "head") {
          const on = this.hono.on as unknown as (
            method: string,
            path: string,
            ...handlers: MiddlewareHandler[]
          ) => unknown;
          return on.call(this.hono, "HEAD", registeredPath, ...stack);
        }
        const verb = this.hono[method] as unknown as (
          path: string,
          ...handlers: MiddlewareHandler[]
        ) => unknown;
        return verb.call(this.hono, registeredPath, ...stack);
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
   * Names this family and the endpoint the request resolved to, built once per registration. Twenty-one families share the
   * `/api` base path, so every one of their app-level middlewares runs for `/api/prompts` and only the route that matched can
   * say which endpoint answered it. The request logger writes one record per request and reads both off the context.
   */
  private stampRoute(method: string, path: string): MiddlewareHandler {
    const family = this.family;
    const route = `${method.toUpperCase()} ${path}`;
    return async (c, next) => {
      c.set(REQUEST_FAMILY, family);
      c.set(ENDPOINT_ROUTE, route);
      await next();
    };
  }

  /**
   * Mount another secured app under this one. Use for composing versioned sub-apps. Routes mounted this way still
   * carry their own declared policies (recorded when they were built). Only a {@link SecuredApp} can be mounted — a
   * raw Hono would smuggle in routes with no declared policy, so wrap one in a SecuredApp first if you must.
   */
  route(path: string, app: SecuredApp<Env>): this {
    this.hono.route(mergePath(this.basePath, path), app.hono);
    return this;
  }

  /** App-level middleware (tracer/logger are already applied). Does not create routes. */
  use(...handlers: MiddlewareHandler[]): this {
    this.scoped(...handlers);
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

function projectStrategy(ports: RestApiServicePorts): AuthStrategy {
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

function orgStrategy(ports: RestApiServicePorts): AuthStrategy {
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
        case "teamPermission":
          return [
            auth,
            ports.authorizeRouteTeamPermission({
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
// Versioned families — the dated-contract surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The per-endpoint meta contract the builder reads back on `onRouteMounted`.
 * Produced by `policy(...)`; an endpoint whose config lacks it fails the
 * build, so a route cannot reach the router unclassified.
 */
export interface VersionedEndpointMeta {
  policy: AccessPolicy;
}

/**
 * One versioned family: the service builder and the policy every route wears.
 */
export interface RestApiVersionedFamily {
  service: ServiceBuilder<unknown, EndpointVariables, unknown>;
  policy: (permission: AuthzPermission) => <TChain extends RouteChain>(b: TChain) => TChain;
}

/**
 * Puts one mount in the route-policy registry, refusing to classify a route that never declared a
 * policy. Every mount the framework creates arrives here: each dated version, `latest`, withdrawn 410
 * tombstones (their inherited config carries the meta), and the two version-namespace guards.
 */
function registerMountedRoute({ route, family }: { route: MountedRoute; family: string }): void {
  if (route.isNamespaceGuard) {
    const policy = publicEndpoint(
      "version-namespace guard: answers 404 for unknown version segments " +
        "so they cannot fall through to a dynamic route; " +
        "reads no data and takes no credential",
    );
    registerRoutePolicy({
      method: route.method,
      path: route.path,
      ...(route.canonicalPath ? { canonicalPath: route.canonicalPath } : {}),
      policy,
      family,
      credentialClass: credentialClassFor({ scope: "organization", policy }),
    });
    return;
  }

  const meta = route.config?.meta as VersionedEndpointMeta | undefined;
  if (!meta?.policy) {
    throw new Error(
      `Versioned endpoint ${route.method.toUpperCase()} ${route.path} ` +
        `declares no access policy; apply policy(permission) at the head of ` +
        `its definition chain`,
    );
  }
  if (meta.policy.kind === "permission" && route.config?.permission !== meta.policy.permission) {
    throw new Error(
      `Versioned endpoint ${route.method.toUpperCase()} ${route.path} ` +
        `declares policy "${meta.policy.permission}" but enforces ` +
        `"${route.config?.permission ?? "nothing"}"; both halves must come ` +
        `from the same policy(permission)`,
    );
  }
  registerRoutePolicy({
    method: route.method,
    path: route.path,
    ...(route.canonicalPath ? { canonicalPath: route.canonicalPath } : {}),
    policy: meta.policy,
    family,
    // The whole family authenticates with an organization-scoped key, so the
    // class is the one a SecuredApp on the organization scope derives.
    credentialClass: credentialClassFor({
      scope: "organization",
      policy: meta.policy,
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The service — the public surface
// ─────────────────────────────────────────────────────────────────────────────

/** Arguments common to every Hono-verb app factory. */
interface SecuredAppArgs {
  basePath: string;
  /**
   * Set `false` to keep the family off `/api/v1`. Reserved for the surfaces
   * that are not the published product API: the browser sign-in door and the
   * deployment's own probes.
   */
  v1Alias?: boolean;
  /**
   * The error shape this family publishes. New families pass `canonical`;
   * the default keeps the families that predate the envelope answering
   * exactly what their consumers already parse.
   */
  errorEnvelope?: ApiErrorEnvelope;
}

/**
 * Every REST family factory a process gets back once it has supplied its
 * ports.
 */
export interface RestApiService<
  ProjectVariables extends object,
  OrganizationVariables extends object,
> {
  /**
   * A project-scoped secured app. Authenticates via project API key / legacy project key / browser
   * session (the process's unified auth middleware) and authorizes `requires(...)` against the caller's
   * project-scoped role bindings — the Hono equivalent of tRPC's `checkProjectPermission`.
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
   * A service-to-service secured app. Routes authenticate with a shared secret / signature
   * (verified by `verifySecret`) rather than an RBAC credential, so the only valid policies
   * are `internalSecret(reason)` and `publicEndpoint(reason)`.
   */
  createServiceApp<E extends Env = Env>(
    args: SecuredAppArgs & {
      verifySecret?: MiddlewareHandler;
      /**
       * Overrides the credential class the family publishes. Set it only when the secret is one
       * an API client holds and the document declares a scheme for it; leaving it unset keeps
       * the honest default, `internal`, which the spec generator refuses to advertise.
       */
      credentialClass?: CredentialClass;
    },
  ): SecuredApp<E>;

  /**
   * An organization-scoped family on the dated-contract framework: versioned
   * paths, declarative input/output schemas and generated OpenAPI.
   */
  createVersionedApp(options: {
    name: string;
    /** Spelled out at the call site so the route-coverage gate can read it. */
    basePath: string;
    /**
     * Per-route middleware applied AFTER authentication and the RBAC check, to
     * every route the family declares.
     */
    routeMiddleware?: readonly MiddlewareHandler[];
  }): RestApiVersionedFamily;

  /**
   * The process's `onError` for the flat legacy body.
   */
  readonly legacyErrorHandler: ErrorHandler;
  /** The process's `onError` for the canonical envelope. @see legacyErrorHandler */
  readonly canonicalErrorHandler: ErrorHandler;
}

/**
 * Bind every REST family factory to one process's authentication, logging,
 * tracing, error rendering and plan gating.
 */
export function createRestApiService<
  ProjectVariables extends object,
  OrganizationVariables extends object,
>(ports: RestApiServicePorts): RestApiService<ProjectVariables, OrganizationVariables> {
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
        ...(args.v1Alias === false ? { v1Alias: false } : {}),
      });
    },

    createVersionedApp({
      name,
      basePath,
      routeMiddleware = [],
    }: {
      name: string;
      basePath: string;
      routeMiddleware?: readonly MiddlewareHandler[];
    }): RestApiVersionedFamily {
      const family = familyFromBasePath(basePath);

      const service = createService({
        name,
        basePath,
        middleware: [ports.appContext],
        auth: ports.authenticateOrganizationThrowing,
        permissionEnforcer: (permission) =>
          ports.authorizeOrganizationPermissionThrowing(permission),
        onRouteMounted: (route) => registerMountedRoute({ route, family }),
      });

      const policy =
        (permission: AuthzPermission) =>
        <TChain extends RouteChain>(b: TChain): TChain =>
          b
            .withPermission(permission)
            .withMeta({ policy: requires(permission) } satisfies VersionedEndpointMeta)
            .withMiddleware(...routeMiddleware);

      return { service, policy };
    },

    legacyErrorHandler: ports.legacyErrorHandler,
    canonicalErrorHandler: ports.canonicalErrorHandler,
  };
}
