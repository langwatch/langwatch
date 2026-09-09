/**
 * The two credentials a family that answers its own refusals resolves through:
 * the project door every SDK key arrives at, and the organization door the
 * management surfaces answer behind.
 */
import {
  type ApiKeyApi,
  type ResolvedApiKeyCredential,
  type ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type {
  AuthzPermission,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  OrganizationNotFoundError,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  ApiOrganizationCredentialClassMismatchError,
  ApiOrganizationInvalidCredentialsError,
  ApiOrganizationAuthenticationUnavailableError,
  ApiOrganizationMissingCredentialsError,
  ApiOrganizationNotFoundForCredentialError,
  ApiOrganizationPermissionError,
} from "../api-rest.security.ts";
import { apiKeyCeilingRefusal } from "./api-key-ceiling-refusal.ts";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials.ts";
import { legacyErrorBody } from "./api-rest-observability.composition.ts";

/** What a resolved credential gives a handler, or what a refused one answers. */
export type HandlerManagedCredential =
  | Readonly<{
      ok: true;
      project: ResolvedApiKeyCredential["project"];
      resolved: ResolvedApiKeyCredential;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** The same, for the organization door, which names no project. */
export type OrganizationManagedCredential =
  | Readonly<{
      ok: true;
      resolved: ResolvedOrganizationApiKeyToken;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/**
 * The sentence an unauthenticated caller of these families receives. It names all three
 * accepted credential shapes because that is what it has always named, and an SDK's own
 * error copy quotes it.
 */
const MISSING_CREDENTIAL_MESSAGE =
  "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";

const INVALID_CREDENTIAL_MESSAGE = "Invalid auth token.";

export class ApiHandlerManagedCredentials {
  static create(options: {
    apiKeys: ApiKeyApi;
    authz: AuthzService;
    /** The directory a resolved organization credential is checked against. */
    organizations: Pick<OrganizationService, "getSettings">;
    logger?: Pick<Logger, "error">;
  }): ApiHandlerManagedCredentials {
    return new ApiHandlerManagedCredentials(
      options.apiKeys,
      options.authz,
      options.organizations,
      options.logger ?? createLogger("langwatch:api:handler-managed-credential"),
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyApi,
    private readonly authz: AuthzService,
    private readonly organizations: Pick<OrganizationService, "getSettings">,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  /**
   * Resolve the request's ORGANIZATION credential and enforce one permission at
   * organization scope. A project key presented here is told so by name rather
   * than refused as invalid: the two are different mistakes to make.
   */
  async authenticateOrganization(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<OrganizationManagedCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) return refusal(new ApiOrganizationMissingCredentialsError());

    const resolution = await this.resolveOrganization(credentials.token);
    if (!resolution.ok) return refusal(resolution.error);

    const resolved = resolution.resolved;
    const known = await this.organizationExists(resolved.organizationId);
    if (!known.ok) return refusal(known.error);

    const allowed = await this.authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      scope: { type: "org", id: resolved.organizationId },
      permission: input.permission,
    });
    if (!allowed) return refusal(new ApiOrganizationPermissionError(input.permission));

    return {
      ok: true,
      resolved,
      markUsed: () => this.apiKeys.markUsed({ id: resolved.apiKeyId }),
    };
  }

  /**
   * The same credential, resolved and asked NOTHING. A family whose routes
   * answer any authenticated caller — `/api/projects` lists what the key
   * reaches — has no permission for the door to ask at the organization.
   */
  async identifyOrganization(input: { request: Request }): Promise<OrganizationManagedCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) return refusal(new ApiOrganizationMissingCredentialsError());

    const resolution = await this.resolveOrganization(credentials.token);
    if (!resolution.ok) return refusal(resolution.error);

    const resolved = resolution.resolved;
    const known = await this.organizationExists(resolved.organizationId);
    if (!known.ok) return refusal(known.error);

    return {
      ok: true,
      resolved,
      markUsed: () => this.apiKeys.markUsed({ id: resolved.apiKeyId }),
    };
  }

  /**
   * Whether the resolved credential holds one permission at the PROJECT a
   * route's own path named. The project is checked to belong to the credential's
   * organization first, so a key cannot reach across tenants by naming an id.
   */
  async authorizeOrganizationRoute(input: {
    credential: ResolvedOrganizationApiKeyToken;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<PermissionDecision> {
    const decision = await this.authz.getApiKeyProjectDecision({
      apiKeyId: input.credential.apiKeyId,
      organizationId: input.credential.organizationId,
      projectId: input.projectId,
      permission: input.permission,
    });

    // No `denialReason`: this door answers from the KEY's grants, and none of
    // the five reasons the vocabulary names — membership, binding, ceiling —
    // is the one that decided a project the key may not reach.
    return { permitted: decision.outcome === "allowed", organizationRole: null };
  }

  /** The organization credential the token stands for, or the refusal it earns. */
  private async resolveOrganization(
    token: string,
  ): Promise<
    | Readonly<{ ok: true; resolved: ResolvedOrganizationApiKeyToken }>
    | Readonly<{ ok: false; error: HandledError }>
  > {
    try {
      const resolution = await this.apiKeys.resolveOrganizationToken({ token });

      if (resolution.ok) return { ok: true, resolved: resolution.resolved };

      return {
        ok: false,
        error:
          resolution.reason === "wrong_credential_class"
            ? new ApiOrganizationCredentialClassMismatchError()
            : new ApiOrganizationInvalidCredentialsError(),
      };
    } catch (error) {
      this.logger.error({ error }, "Organization credential resolution failed");

      return { ok: false, error: new ApiOrganizationAuthenticationUnavailableError() };
    }
  }

  /**
   * A deleted organization is an expected refusal and stays quiet; any other
   * failure is the lookup itself breaking, and the answer the caller receives
   * carries none of the cause, so it is logged here or lost.
   */
  private async organizationExists(
    organizationId: string,
  ): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; error: HandledError }>> {
    try {
      await this.organizations.getSettings({ organizationId });

      return { ok: true };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return { ok: false, error: new ApiOrganizationNotFoundForCredentialError() };
      }
      this.logger.error(
        { error, organizationId },
        "Organization lookup failed while authenticating an organization credential",
      );

      return { ok: false, error: new ApiOrganizationAuthenticationUnavailableError() };
    }
  }

  /**
   * Resolve the request's project credential and enforce one permission as an API-key
   * ceiling.
   */
  async authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<HandlerManagedCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) {
      return { ok: false, status: 401, body: { message: MISSING_CREDENTIAL_MESSAGE } };
    }

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      return { ok: false, status: 401, body: { message: INVALID_CREDENTIAL_MESSAGE } };
    }

    if (resolved.type === "apiKey") {
      const allowed = await this.isWithinCeiling({
        resolved,
        permission: input.permission,
      });
      if (!allowed) {
        const refusal = apiKeyCeilingRefusal(resolved, input.permission, this.logger);
        return {
          ok: false,
          status: refusal.httpStatus as ContentfulStatusCode,
          body: handledErrorResponseBody(refusal),
        };
      }
    }

    return {
      ok: true,
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") {
          this.apiKeys.markUsed({ id: resolved.apiKeyId });
        }
      },
    };
  }

  /**
   * Enforces one permission as an ALREADY-RESOLVED key's ceiling, THROWING the same
   * refusal {@link authenticate} would have answered with.
   */
  async enforceCeiling(input: {
    resolved: ResolvedApiKeyCredential;
    permission: AuthzPermission;
  }): Promise<void> {
    // A legacy project key has no per-permission ceiling: project keys predate
    // RBAC and carry full project access by design, so a route's declared
    // permission is decorative for that credential class.
    if (input.resolved.type !== "apiKey") return;
    const allowed = await this.isWithinCeiling({
      resolved: input.resolved,
      permission: input.permission,
    });
    if (!allowed) throw apiKeyCeilingRefusal(input.resolved, input.permission, this.logger);
  }

  private isWithinCeiling(input: {
    resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>;
    permission: AuthzPermission;
  }): Promise<boolean> {
    const { resolved, permission } = input;
    return this.authz.hasApiKeyPermission({
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
  }
}

/** One refused credential, in the flat body the process's own boundary writes. */
function refusal(error: HandledError): OrganizationManagedCredential {
  return {
    ok: false,
    status: error.httpStatus as ContentfulStatusCode,
    body: legacyErrorBody(error),
  };
}

/**
 * The wire body for a handled error answered by a middleware rather than by an error
 * boundary: the code as the discriminant, the sentence, the meta bag spread flat, and the
 * remediation channel alongside. The same shape the process's own error boundary writes.
 */
function handledErrorResponseBody(error: HandledError): object {
  const { code, message, meta, tips, docsUrl, fault, retryable } = error;
  return {
    error: code,
    message,
    ...meta,
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(fault ? { fault } : {}),
    retryable: retryable === true,
  };
}
