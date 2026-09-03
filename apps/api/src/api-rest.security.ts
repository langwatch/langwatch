import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  type ApiKeyService,
  type ResolvedApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { AuthenticatedActorRequiredError } from "@langwatch/api";
import {
  createAppRestSecurity,
  type ApiErrorEnvelope,
  type AppRestSecurity,
  type AppRestSecurityPorts,
  type RequestActor,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { classifyForLangy } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  OrganizationNotFoundError,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { extractApiKeyRequestCredentials } from "./app/api-key-request-credentials";
import type { ApiAuditPort } from "./api-request.policy";

/**
 * The credential refusals this process publishes, one class per code.
 *
 * They were two classes over seven codes, each picking its code from a
 * constructor parameter. That shape is invisible to the registry guard in
 * `apps/ui/src/model/errors/__tests__/codes.unit.test.ts`, which finds a code
 * by the string literal at its declaration: a union in a signature has no
 * literal to find, and a `declare readonly code:` union yields only its FIRST
 * member. `credential_class_mismatch` and `invalid_credentials` were therefore
 * raised here and reported as copy nothing raises, which is the same report a
 * genuinely dead entry produces.
 *
 * The guard's own docblock names the remedy and prefers this one: a subclass
 * per code, so the scanner sees every code and a code added here can never
 * reach a customer without copy. The alternative — listing them in that file's
 * `PARAMETERIZED_CODES` — buys the same green run at the price of
 * hand-maintenance, and these families do not share one body: two statuses,
 * two faults, two legacy labels and a `meta` on exactly one of them.
 */

/** No credential at all on a project route. */
export class ApiRestMissingCredentialsError extends HandledError {
  declare readonly code: "missing_credentials";
  readonly legacyError = "Unauthorized";

  constructor() {
    super("missing_credentials", "Authentication required", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ApiRestMissingCredentialsError";
  }
}

/** A project credential that resolves to nothing. */
export class ApiRestInvalidCredentialsError extends HandledError {
  declare readonly code: "invalid_credentials";
  readonly legacyError = "Unauthorized";

  constructor() {
    super("invalid_credentials", "Invalid credentials", { httpStatus: 401, fault: "customer" });
    this.name = "ApiRestInvalidCredentialsError";
  }
}

/** No credential at all on a management route. */
export class ApiOrganizationMissingCredentialsError extends HandledError {
  declare readonly code: "missing_credentials";
  readonly legacyError = "Unauthorized";

  constructor() {
    super("missing_credentials", "Authentication required. Use Authorization: Bearer <api-key>.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ApiOrganizationMissingCredentialsError";
  }
}

/**
 * A project key presented where an organization key is required.
 *
 * Its own code rather than a plain refusal because the remediation is
 * specific and actionable: the caller holds a valid key of the wrong class,
 * and `meta` names both classes so a client can say which to swap in.
 */
export class ApiOrganizationCredentialClassMismatchError extends HandledError {
  declare readonly code: "credential_class_mismatch";
  readonly legacyError = "Unauthorized";

  constructor() {
    super(
      "credential_class_mismatch",
      "This endpoint needs an organization API key. The key sent is a project API key.",
      {
        httpStatus: 401,
        fault: "customer",
        meta: { required: "organization_api_key", presented: "project_api_key" },
      },
    );
    this.name = "ApiOrganizationCredentialClassMismatchError";
  }
}

/** An organization credential that resolves to nothing. */
export class ApiOrganizationInvalidCredentialsError extends HandledError {
  declare readonly code: "invalid_credentials";
  readonly legacyError = "Unauthorized";

  constructor() {
    super("invalid_credentials", "Invalid credentials.", { httpStatus: 401, fault: "customer" });
    this.name = "ApiOrganizationInvalidCredentialsError";
  }
}

/**
 * A credential whose organization has since been deleted.
 *
 * 401 rather than 404: the caller's credential is what stopped being usable,
 * and a management route that answered 404 would confirm the deletion to
 * whoever still holds the key.
 */
export class ApiOrganizationNotFoundForCredentialError extends HandledError {
  declare readonly code: "organization_not_found";
  readonly legacyError = "Unauthorized";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ApiOrganizationNotFoundForCredentialError";
  }
}

/**
 * The credential lookup itself failed.
 *
 * The one 5xx of the family, and `fault` says so explicitly: an unannotated
 * 500 defaults to `"customer"` and would record a real incident as routine
 * refusal noise.
 */
export class ApiOrganizationAuthenticationUnavailableError extends HandledError {
  declare readonly code: "internal_error";
  readonly legacyError = "Internal Server Error";

  constructor() {
    super("internal_error", "Authentication service error", {
      httpStatus: 500,
      fault: "platform",
    });
    this.name = "ApiOrganizationAuthenticationUnavailableError";
  }
}

/**
 * The refusal for a route naming a project the credential cannot reach.
 *
 * 404 rather than 403 deliberately: a project that does not exist and one the
 * caller may not see must be indistinguishable, or the status code itself
 * confirms existence to an unauthorized caller.
 */
export class ApiRouteProjectNotFoundError extends HandledError {
  readonly legacyError = "Not Found";

  constructor() {
    super("project_not_found", "Project not found", { httpStatus: 404, fault: "customer" });
    this.name = "ApiRouteProjectNotFoundError";
  }
}

/** The organization-permission refusal the management families publish. */
export class ApiOrganizationPermissionError extends HandledError {
  readonly legacyError = "Forbidden";

  constructor(permission: AuthzPermission) {
    super("insufficient_permissions", `Insufficient permissions. Required: ${permission}`, {
      httpStatus: 403,
      fault: "customer",
      meta: { required_permission: permission },
    });
    this.name = "ApiOrganizationPermissionError";
  }
}

/**
 * What the process supplies beyond its own product services: observability
 * middleware and the two error renderers.
 *
 * Neither can come from `@langwatch/api` — a logger and a tracer are the
 * process's, and both error shapes render the application's own taxonomy —
 * so composition passes them in once and every family it builds gets them.
 */
export interface ApiRestSecurityObservability {
  /** Installs the process's application container on the request context. */
  readonly appContext: MiddlewareHandler;
  readonly requestLogger: () => MiddlewareHandler;
  readonly requestTracer: (options: { name: string }) => MiddlewareHandler;
  /** `onError` for a family publishing the flat legacy body. */
  readonly legacyErrorHandler: ErrorHandler;
  /** `onError` for a family publishing the canonical envelope. */
  readonly canonicalErrorHandler: ErrorHandler;
}

/**
 * The API process's REST enforcement, in the shape `@langwatch/api/rest`
 * builds every family from.
 *
 * This replaces the pair of bespoke ports the process used to define
 * (`ApiRestSecurityPort` / `ApiOrganizationRestSecurityPort`) and their two
 * hand-rolled policy bridges. The framework already knows how to turn an
 * `AccessPolicy` into an authenticate-then-authorize chain and to record the
 * decision in the route registry; what it cannot know is how THIS process
 * resolves a credential. That is all this class supplies.
 *
 * Two credential classes, because the deployment has two: a project API key
 * (or a legacy project key) for the product routes, and an organization API
 * key for the management routes. They resolve through different service calls
 * and refuse with different bodies, so they are separate ports rather than one
 * port in two moods.
 */
export class ApiRestSecurity {
  /**
   * Bind the framework's REST service builder to this process's services.
   *
   * Returns the `AppRestSecurity` every REST family factory takes — obtaining
   * it is the only way to build one, which is what makes a route with no
   * declared access policy impossible to construct.
   */
  static create(options: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
    organizations: OrganizationService;
    observability: ApiRestSecurityObservability;
    audit?: ApiAuditPort;
    logger?: Pick<Logger, "error">;
  }): AppRestSecurity {
    const security = new ApiRestSecurity(
      options.apiKeys,
      options.authz,
      options.organizations,
      options.audit,
      options.logger ?? createLogger("langwatch:api:rest-security"),
    );
    return createAppRestSecurity(security.ports(options.observability));
  }

  /**
   * The same enforcement, exposed as the four callables
   * `createRestService` takes.
   *
   * A family built by the additive public-REST builder rather than by
   * `AppRestSecurity.createProjectApp` — Secret is the one today — installs
   * its chain through these. They are the SAME middleware the ports above
   * hand the framework, so the two doors cannot enforce differently; what
   * differs is only the shape the builder asks for.
   */
  static projectPolicy(options: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
    organizations: OrganizationService;
    audit?: ApiAuditPort;
    logger?: Pick<Logger, "error">;
  }): ApiRestProjectPolicy {
    return new ApiRestProjectPolicy(
      new ApiRestSecurity(
        options.apiKeys,
        options.authz,
        options.organizations,
        options.audit,
        options.logger ?? createLogger("langwatch:api:rest-security"),
      ),
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
    private readonly organizations: OrganizationService,
    private readonly audit: ApiAuditPort | undefined,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  private ports(observability: ApiRestSecurityObservability): AppRestSecurityPorts {
    return {
      appContext: observability.appContext,
      requestLogger: observability.requestLogger,
      requestTracer: observability.requestTracer,
      legacyErrorHandler: observability.legacyErrorHandler,
      canonicalErrorHandler: observability.canonicalErrorHandler,

      authenticateProject: (envelope) => this.projectAuthentication(envelope),
      authorizeProjectPermission: ({ permission, envelope }) =>
        this.projectAuthorization(permission, envelope),
      authorizeApiKeyCeiling: ({ permission, envelope }) =>
        this.apiKeyCeiling(permission, envelope),

      authenticateOrganization: (envelope) => this.organizationAuthentication(envelope),
      authorizeOrganizationPermission: ({ permission, envelope }) =>
        this.organizationAuthorization(permission, envelope),
      authorizeRouteProjectPermission: ({ permission, param, envelope }) =>
        this.routeProjectAuthorization(permission, param, envelope),

      authenticateOrganizationThrowing: this.organizationAuthentication("throw"),
      authorizeOrganizationPermissionThrowing: (permission) =>
        this.organizationAuthorization(permission, "throw"),
    };
  }

  /**
   * Resolves a project credential and installs it, then stamps the key as
   * used and audits the write once the handler has answered successfully.
   *
   * The mark-used and the audit are deliberately after `next()` and gated on a
   * 2xx: a refused request must not move the key's last-used clock, and a
   * failed write is not something to record as one.
   */
  /** @internal Shared with {@link ApiRestProjectPolicy}. */
  projectAuthentication(envelope: Envelope): MiddlewareHandler {
    return async (context, next) => {
      const credentials = extractApiKeyRequestCredentials(context.req.raw);
      if (!credentials) {
        return this.refuse(context, new ApiRestMissingCredentialsError(), envelope);
      }

      const resolved = await this.apiKeys.tryResolveToken(credentials);
      if (!resolved) {
        return this.refuse(context, new ApiRestInvalidCredentialsError(), envelope);
      }

      installProjectVariables(context, resolved);
      await next();

      if (context.res.status >= 200 && context.res.status < 300) {
        await this.completeProjectRequest(context, resolved);
      }
      return;
    };
  }

  /**
   * The RBAC check for a project route. A legacy project key carries full
   * access by construction and is not checked; a scoped API key must hold the
   * permission at the project's scope.
   */
  /** @internal Shared with {@link ApiRestProjectPolicy}. */
  projectAuthorization(permission: AuthzPermission, envelope: Envelope): MiddlewareHandler {
    return async (context, next) => {
      const resolved = context.get("resolvedToken") as ResolvedApiKeyToken | undefined;
      if (!resolved || resolved.type !== "apiKey") {
        return next();
      }

      const allowed = await this.authz.hasApiKeyPermission({
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId ?? null,
        organizationId: resolved.organizationId,
        scope: {
          type: "project",
          id: resolved.project.id,
          teamId: resolved.project.teamId,
        },
        permission,
      });
      if (!allowed) {
        return this.refuse(context, apiKeyCeilingRefusal(resolved, permission), envelope);
      }
      return next();
    };
  }

  /**
   * The API-key ceiling. Identical enforcement to
   * {@link projectAuthorization}: a scoped key must hold the permission, a
   * legacy project key keeps full access. Named apart because the framework
   * installs it at a different point in the chain — a route can declare a
   * SECOND permission beyond its access policy, and that one is a ceiling
   * check rather than the route's own RBAC decision.
   */
  private apiKeyCeiling(permission: AuthzPermission, envelope: Envelope): MiddlewareHandler {
    return this.projectAuthorization(permission, envelope);
  }

  /**
   * Resolves an organization credential and installs it, then stamps the key
   * as used on success.
   *
   * The organization is looked up rather than trusted from the token: a key
   * whose organization has since been deleted must refuse rather than serve a
   * management route against a tenant that no longer exists.
   */
  private organizationAuthentication(envelope: Envelope): MiddlewareHandler {
    return async (context, next) => {
      const credentials = extractApiKeyRequestCredentials(context.req.raw);
      if (!credentials) {
        return this.refuse(context, new ApiOrganizationMissingCredentialsError(), envelope);
      }

      let resolution;
      try {
        resolution = await this.apiKeys.resolveOrganizationToken({ token: credentials.token });
      } catch (error) {
        this.logger.error(
          { error, method: context.req.method, path: context.req.path },
          "Organization credential resolution failed",
        );
        return this.refuse(context, new ApiOrganizationAuthenticationUnavailableError(), envelope);
      }

      if (!resolution.ok) {
        return this.refuse(
          context,
          resolution.reason === "wrong_credential_class"
            ? new ApiOrganizationCredentialClassMismatchError()
            : new ApiOrganizationInvalidCredentialsError(),
          envelope,
        );
      }

      const resolved = resolution.resolved;
      try {
        await this.organizations.getSettings({ organizationId: resolved.organizationId });
      } catch (error) {
        // A deleted organization is an expected refusal and stays quiet; any
        // other failure is the lookup itself breaking, and the 500 the caller
        // receives carries none of the cause, so it is logged here or lost.
        const organizationMissing = error instanceof OrganizationNotFoundError;
        if (!organizationMissing) {
          this.logger.error(
            {
              error,
              method: context.req.method,
              path: context.req.path,
              organizationId: resolved.organizationId,
            },
            "Organization lookup failed while authenticating an organization credential",
          );
        }
        return this.refuse(
          context,
          organizationMissing
            ? new ApiOrganizationNotFoundForCredentialError()
            : new ApiOrganizationAuthenticationUnavailableError(),
          envelope,
        );
      }

      installOrganizationVariables(context, resolved);
      await next();

      if (context.res.status >= 200 && context.res.status < 300) {
        this.apiKeys.markUsed({ id: resolved.apiKeyId });
      }
      return;
    };
  }

  private organizationAuthorization(
    permission: AuthzPermission,
    envelope: Envelope,
  ): MiddlewareHandler {
    return async (context, next) => {
      const organizationId = context.get("apiKeyOrganizationId") as string;
      const allowed = await this.authz.hasApiKeyPermission({
        apiKeyId: context.get("apiKeyId") as string,
        userId: (context.get("apiKeyUserId") as string | null) ?? null,
        organizationId,
        scope: { type: "org", id: organizationId },
        permission,
      });
      if (!allowed) {
        return this.refuse(context, new ApiOrganizationPermissionError(permission), envelope);
      }
      return next();
    };
  }

  /**
   * RBAC at the scope of the project named in the route, for an
   * organization-authenticated family addressing one project at a time. The
   * project id comes from the path parameter the caller named, never from the
   * credential — that is what makes it a per-project check rather than an
   * organization-wide one.
   */
  private routeProjectAuthorization(
    permission: AuthzPermission,
    param: string,
    envelope: Envelope,
  ): MiddlewareHandler {
    return async (context, next) => {
      const projectId = context.req.param(param);
      const decision = projectId
        ? await this.authz.getApiKeyProjectDecision({
            apiKeyId: context.get("apiKeyId") as string,
            userId: (context.get("apiKeyUserId") as string | null) ?? null,
            organizationId: context.get("apiKeyOrganizationId") as string,
            projectId,
            permission,
          })
        : ({ outcome: "project_not_found" } as const);

      // A project the caller cannot see and one that does not exist answer the
      // same way on purpose: confirming existence to an unauthorized caller is
      // an enumeration vector.
      if (decision.outcome === "project_not_found") {
        return this.refuse(context, new ApiRouteProjectNotFoundError(), envelope);
      }
      if (decision.outcome === "denied") {
        return this.refuse(context, new ApiOrganizationPermissionError(permission), envelope);
      }
      return next();
    };
  }

  /**
   * Stamps the key as used, and records a successful mutation in the audit
   * trail. Audit failures are logged and swallowed: the write has already
   * committed when this runs, so raising here would report a failure the
   * caller cannot act on for a request that in fact succeeded.
   */
  private async completeProjectRequest(
    context: Context,
    resolved: ResolvedApiKeyToken,
  ): Promise<void> {
    if (resolved.type !== "apiKey") {
      return;
    }

    this.apiKeys.markUsed({ id: resolved.apiKeyId });
    if (!isMutation(context.req.method) || !resolved.userId) {
      return;
    }

    try {
      await this.audit?.record({
        actorId: resolved.userId,
        path: context.req.path,
        input: {
          method: context.req.method,
          projectId: resolved.project.id,
          status: context.res.status,
        },
        error: null,
      });
    } catch (error) {
      this.logger.error(
        {
          error,
          method: context.req.method,
          path: context.req.path,
          projectId: resolved.project.id,
        },
        "REST request audit failed after a successful response",
      );
    }
  }

  /**
   * Render a refusal in the shape the family publishes, or raise it for a
   * versioned family that renders every refusal through its own error handler.
   *
   * `throw` is not a third envelope: it is the mode the framework's versioned
   * builder asks for, because a middleware that wrote its own body there would
   * publish a shape the family's error contract never declared.
   */
  private refuse(context: Context, error: HandledError, envelope: Envelope): Response {
    if (envelope === "throw") {
      throw error;
    }
    if (envelope === "legacy") {
      const legacyError = "legacyError" in error ? error.legacyError : error.code;
      return context.json(
        { error: legacyError, message: error.message, ...error.meta },
        error.httpStatus as 401 | 403 | 404 | 500,
      );
    }
    throw error;
  }
}

/**
 * The project-scope chain in the shape `createRestService` takes.
 *
 * Four callables over one {@link ApiRestSecurity}: the same middleware the
 * framework ports hand out, re-shaped for the additive public-REST builder.
 * Nothing is re-implemented here — a second implementation of "is this caller
 * allowed" is exactly the drift this class exists to prevent.
 */
export class ApiRestProjectPolicy {
  constructor(private readonly security: ApiRestSecurity) {}

  /** The authenticate-and-stamp middleware, publishing the legacy body. */
  authenticationMiddleware(): MiddlewareHandler {
    return this.security.projectAuthentication("legacy");
  }

  /** The RBAC check for one permission, publishing the legacy body. */
  permissionMiddleware(permission: AuthzPermission): MiddlewareHandler {
    return this.security.projectAuthorization(permission, "legacy");
  }

  /**
   * The signed-in actor behind the request, for a handler that attributes a
   * write. Raises when the credential carries no user — a legacy project key
   * authenticates a project, not a person.
   */
  actor(context: Context): RequestActor {
    const userId = context.get("apiKeyUserId") as string | undefined;
    if (!userId) {
      throw new AuthenticatedActorRequiredError();
    }
    return { id: userId };
  }

  /** The RBAC check as a call rather than a middleware. */
  async authorize(context: Context, permission: AuthzPermission): Promise<void> {
    await this.security.projectAuthorization(permission, "throw")(context, async () => {});
  }
}

/** The refusal mode a chain answers in; `throw` is the versioned-family mode. */
type Envelope = ApiErrorEnvelope | "throw";

function installProjectVariables(context: Context, resolved: ResolvedApiKeyToken): void {
  context.set("project", resolved.project);
  context.set("resolvedToken", resolved);
  if (resolved.type === "apiKey") {
    context.set("apiKeyId", resolved.apiKeyId);
    context.set("apiKeyUserId", resolved.userId);
    context.set("apiKeyOrganizationId", resolved.organizationId);
  }
}

function installOrganizationVariables(
  context: Context,
  resolved: { apiKeyId: string; userId: string | null; organizationId: string },
): void {
  context.set("organization", { id: resolved.organizationId });
  context.set("apiKeyId", resolved.apiKeyId);
  context.set("apiKeyUserId", resolved.userId);
  context.set("apiKeyOrganizationId", resolved.organizationId);
  context.set("orgResolvedToken", resolved);
}

/**
 * Which refusal a scoped key gets when it lacks a permission.
 *
 * A Langy session key that asks for something Langy may never delegate is a
 * DIFFERENT refusal from an ordinary key that simply lacks the grant — the
 * first can never be fixed by widening the key, and saying so is the point.
 */
function apiKeyCeilingRefusal(
  resolved: Extract<ResolvedApiKeyToken, { type: "apiKey" }>,
  permission: AuthzPermission,
): HandledError {
  const meta = {
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId ?? null,
    projectId: resolved.project.id,
  };
  const langy = resolved.isLangySessionKey ? classifyForLangy(permission) : null;
  if (langy && langy.disposition !== "granted") {
    return new ApiKeyPermissionNotDelegableError(permission, { subject: "Langy", meta });
  }
  return new ApiKeyPermissionDeniedError(permission, { meta });
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
