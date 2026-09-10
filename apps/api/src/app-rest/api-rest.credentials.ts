/**
 * The two credentials this process resolves for itself: the project door every
 * SDK key arrives at, and the organization door the management surfaces answer
 * behind.
 *
 * It reads three peer Apps and nothing else. Every one of them is another
 * module resolved by the same boot that mounts the routes, which is why the
 * process states its doors as a factory rather than building them beforehand.
 */
import {
  type ApiKeyApi,
  type ResolvedApiKeyCredential,
  type ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzApi, AuthzPermission, PermissionDecision } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { canonicalErrorFor } from "../app/api-canonical-error.ts";
import { apiKeyCeilingRefusal } from "../app/api-key-ceiling-refusal.ts";
import { extractApiKeyRequestCredentials } from "../app/api-key-request-credentials.ts";
import {
  ApiOrganizationAuthenticationUnavailableError,
  ApiOrganizationCredentialClassMismatchError,
  ApiOrganizationInvalidCredentialsError,
  ApiOrganizationMissingCredentialsError,
  ApiOrganizationNotFoundForCredentialError,
  ApiOrganizationPermissionError,
  INVALID_PROJECT_CREDENTIAL_MESSAGE,
  MISSING_PROJECT_CREDENTIAL_MESSAGE,
} from "./api-rest.refusals.ts";

/** What a resolved project credential gives a door, or what a refused one answers. */
export type ApiProjectCredential =
  | Readonly<{
      ok: true;
      project: ResolvedApiKeyCredential["project"];
      resolved: ResolvedApiKeyCredential;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** The same, for the organization door, which names no project. */
export type ApiOrganizationCredential =
  | Readonly<{
      ok: true;
      resolved: ResolvedOrganizationApiKeyToken;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** The peer Apps the two credential chains read. */
export type ApiRestCredentialPeers = Readonly<{
  apiKeys: ApiKeyApi;
  authz: Pick<AuthzApi, "hasApiKeyPermission" | "getApiKeyProjectDecision">;
  organizations: Pick<OrganizationApi, "getSettings">;
  logger?: Pick<Logger, "error">;
}>;

export class ApiRestCredentials {
  static create(peers: ApiRestCredentialPeers): ApiRestCredentials {
    return new ApiRestCredentials(
      peers.apiKeys,
      peers.authz,
      peers.organizations,
      peers.logger ?? createLogger("langwatch:api:rest:credential"),
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyApi,
    private readonly authz: ApiRestCredentialPeers["authz"],
    private readonly organizations: ApiRestCredentialPeers["organizations"],
    private readonly logger: Pick<Logger, "error">,
  ) {}

  /**
   * Resolve the request's project credential and enforce one permission as an
   * API-key ceiling.
   */
  async authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ApiProjectCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) {
      return { ok: false, status: 401, body: { message: MISSING_PROJECT_CREDENTIAL_MESSAGE } };
    }

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      return { ok: false, status: 401, body: { message: INVALID_PROJECT_CREDENTIAL_MESSAGE } };
    }

    if (resolved.type === "apiKey") {
      const allowed = await this.isWithinCeiling({ resolved, permission: input.permission });
      if (!allowed) {
        const refusal = apiKeyCeilingRefusal(resolved, input.permission, this.logger);
        return {
          ok: false,
          status: refusal.httpStatus as ContentfulStatusCode,
          body: canonicalErrorFor(refusal).body,
        };
      }
    }

    return {
      ok: true,
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  /**
   * The same project credential, resolved and asked NOTHING. A route that
   * answers any authenticated caller has no permission for the door to enforce
   * as the key's ceiling.
   */
  async identify(input: { request: Request }): Promise<ApiProjectCredential> {
    const credentials = extractApiKeyRequestCredentials(input.request);
    if (!credentials) {
      return { ok: false, status: 401, body: { message: MISSING_PROJECT_CREDENTIAL_MESSAGE } };
    }

    const resolved = await this.apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      return { ok: false, status: 401, body: { message: INVALID_PROJECT_CREDENTIAL_MESSAGE } };
    }

    return {
      ok: true,
      project: resolved.project,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  /**
   * Resolve the request's ORGANIZATION credential and enforce one permission at
   * organization scope. A project key presented here is told so by name rather
   * than refused as invalid: the two are different mistakes to make.
   */
  async authenticateOrganization(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ApiOrganizationCredential> {
    const identified = await this.identifyOrganization(input);
    if (!identified.ok) return identified;

    const resolved = identified.resolved;
    const allowed = await this.authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      scope: { type: "org", id: resolved.organizationId },
      permission: input.permission,
    });
    if (!allowed) return refusal(new ApiOrganizationPermissionError(input.permission));

    return identified;
  }

  /**
   * The same credential, resolved and asked NOTHING. A family whose routes
   * answer any authenticated caller has no permission for the door to ask at
   * the organization.
   */
  async identifyOrganization(input: { request: Request }): Promise<ApiOrganizationCredential> {
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
   * route's own path named. The project is checked against the credential's
   * organization, so a key cannot reach across tenants by naming an id.
   */
  async authorizeOrganizationRoute(input: {
    credential: ResolvedOrganizationApiKeyToken;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<PermissionDecision> {
    const decision = await this.authz.getApiKeyProjectDecision({
      apiKeyId: input.credential.apiKeyId,
      userId: input.credential.userId,
      organizationId: input.credential.organizationId,
      projectId: input.projectId,
      permission: input.permission,
    });

    // No `denialReason`: this door answers from the KEY's grants, and none of
    // the five reasons the vocabulary names is the one that decided a project
    // the key may not reach.
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

  private isWithinCeiling(input: {
    resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>;
    permission: AuthzPermission;
  }): Promise<boolean> {
    const { resolved, permission } = input;
    return this.authz.hasApiKeyPermission({
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId ?? null,
      organizationId: resolved.organizationId,
      scope: { type: "project", id: resolved.project.id, teamId: resolved.project.teamId },
      permission,
    });
  }
}

/** One refused credential, in the canonical envelope this process writes. */
function refusal(error: HandledError): ApiOrganizationCredential {
  return {
    ok: false,
    status: error.httpStatus as ContentfulStatusCode,
    body: canonicalErrorFor(error).body,
  };
}
