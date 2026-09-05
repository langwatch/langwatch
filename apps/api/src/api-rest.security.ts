import { type ApiKeyService, type ResolvedApiKeyToken } from "@langwatch/api-key-contract";
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
import { createLogger, type Logger } from "@langwatch/observability";
import {
  OrganizationNotFoundError,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { apiKeyCeilingRefusal } from "./app/api-key-ceiling-refusal";
import { extractApiKeyRequestCredentials } from "./app/api-key-request-credentials";
import { legacyErrorBody } from "./app/api-rest-observability.composition";
import type { ApiAuditPort } from "./api-request.policy";

/**
 * The credential refusals this process publishes, one class per code. They were two
 * classes over seven codes, each picking its code from a constructor parameter.
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
 * A credential whose organization has since been deleted. 401 rather than 404: the
 * caller's credential is what stopped being usable, and a management route that answered
 * 404 would confirm the deletion to whoever still holds the key.
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
 * The credential lookup itself failed. The one 5xx of the family, and `fault` says so
 * explicitly: an unannotated 500 defaults to `"customer"` and would record a real
 * incident as routine refusal noise.
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
 * The refusal for a route naming a project the credential cannot reach. 404 rather than
 * 403 deliberately: a project that does not exist and one the caller may not see must be
 * indistinguishable, or the status code itself confirms existence to an unauthorized
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
 * What the process supplies beyond its own product services: observability middleware and
 * the two error renderers.
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
 * The API process's REST enforcement, in the shape `@langwatch/api/rest` builds every
 * family from.
 */
export class ApiRestSecurity {
  /**
   * Bind the framework's REST service builder to this process's services.
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
   * The same enforcement, exposed as the four callables `createRestService` takes.
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
      authorizeRouteTeamPermission: ({ permission, param, envelope }) =>
        this.routeTeamAuthorization(permission, param, envelope),

      authenticateOrganizationThrowing: this.organizationAuthentication("throw"),
      authorizeOrganizationPermissionThrowing: (permission) =>
        this.organizationAuthorization(permission, "throw"),
    };
  }

  /**
   * Resolves a project credential and installs it, then stamps the key as used and audits
   * the write once the handler has answered successfully.
   * @internal Shared with {@link ApiRestProjectPolicy}.
   */
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
   * The RBAC check for a project route.
   * @internal Shared with {@link ApiRestProjectPolicy}.
   */
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
        return this.refuse(
          context,
          apiKeyCeilingRefusal(resolved, permission, this.logger),
          envelope,
        );
      }
      return next();
    };
  }

  /**
   * The API-key ceiling. Identical enforcement to {@link projectAuthorization}: a scoped
   * key must hold the permission, a legacy project key keeps full access.
   */
  private apiKeyCeiling(permission: AuthzPermission, envelope: Envelope): MiddlewareHandler {
    return this.projectAuthorization(permission, envelope);
  }

  /**
   * Resolves an organization credential and installs it, then stamps the key as used on
   * success.
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
   * organization-authenticated family addressing one project at a time.
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
   * RBAC at the scope of the team named in the route.
   */
  private routeTeamAuthorization(
    permission: AuthzPermission,
    param: string,
    envelope: Envelope,
  ): MiddlewareHandler {
    return async (context, next) => {
      const teamId = context.req.param(param);
      const organizationId = context.get("apiKeyOrganizationId") as string;
      const allowed = teamId
        ? await this.authz.hasApiKeyPermission({
            apiKeyId: context.get("apiKeyId") as string,
            userId: (context.get("apiKeyUserId") as string | null) ?? null,
            organizationId,
            scope: { type: "team", id: teamId },
            permission,
          })
        : false;

      if (!allowed) {
        return this.refuse(context, new ApiOrganizationPermissionError(permission), envelope);
      }
      return next();
    };
  }

  /**
   * Stamps the key as used, and records a successful mutation in the audit trail.
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
   * Render a refusal in the shape the family publishes, or raise it for a versioned
   * family that renders every refusal through its own error handler.
   */
  private refuse(context: Context, error: HandledError, envelope: Envelope): Response {
    if (envelope === "throw") {
      throw error;
    }
    if (envelope === "legacy") {
      // The one legacy body, shared with the process's `onError`. A second
      // implementation here is how a denial came to publish a code and a
      // sentence while every refusal rendered by the boundary also carried
      // its fault, remediation and reasons.
      return context.json(legacyErrorBody(error), error.httpStatus as 401 | 403 | 404 | 500);
    }
    throw error;
  }
}

/**
 * The project-scope chain in the shape `createRestService` takes. Four callables over one
 * {@link ApiRestSecurity}: the same middleware the framework ports hand out, re-shaped
 * for the additive public-REST builder.
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

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
