import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  OrganizationNotFoundError,
  type OrganizationService,
} from "@langwatch/organization-contract";
import {
  ApiOrganizationRestSecurityPort,
  type ApiOrganizationRestAuthenticatedRequest,
  type ApiOrganizationRestSuccessfulResponse,
} from "../api-rest.security";
import { extractApiKeyRequestCredentials } from "./api-key-request-credentials";

type OrganizationAuthenticationCode =
  | "missing_credentials"
  | "invalid_credentials"
  | "credential_class_mismatch"
  | "organization_not_found"
  | "internal_error";

/** A legacy-flat error label retained by the API-key management transport. */
export class ApiOrganizationAuthenticationError extends HandledError {
  readonly legacyError: "Unauthorized" | "Internal Server Error";

  constructor(code: OrganizationAuthenticationCode) {
    const details = authenticationDetails(code);
    super(code, details.message, {
      httpStatus: details.status,
      fault: details.status >= 500 ? "platform" : "customer",
      ...(details.meta ? { meta: details.meta } : {}),
    });
    this.legacyError = details.legacyError;
    this.name = "ApiOrganizationAuthenticationError";
  }
}

/** The management route's existing organization-permission refusal. */
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

/** Adapts canonical API-key, Organization, and AuthZ services to org REST security. */
export class ApiKeyOrganizationRestSecurityAdapter extends ApiOrganizationRestSecurityPort {
  static create(options: {
    apiKeys: ApiKeyService;
    authz: AuthzService;
    organizations: OrganizationService;
  }): ApiKeyOrganizationRestSecurityAdapter {
    return new ApiKeyOrganizationRestSecurityAdapter(
      options.apiKeys,
      options.authz,
      options.organizations,
    );
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
    private readonly organizations: OrganizationService,
  ) {
    super();
  }

  async authenticate(request: Request): Promise<ApiOrganizationRestAuthenticatedRequest> {
    const credentials = extractApiKeyRequestCredentials(request);
    if (!credentials) {
      throw new ApiOrganizationAuthenticationError("missing_credentials");
    }

    let resolution;
    try {
      resolution = await this.apiKeys.resolveOrganizationToken({ token: credentials.token });
    } catch {
      throw new ApiOrganizationAuthenticationError("internal_error");
    }

    if (!resolution.ok) {
      throw new ApiOrganizationAuthenticationError(
        resolution.reason === "wrong_credential_class"
          ? "credential_class_mismatch"
          : "invalid_credentials",
      );
    }

    try {
      await this.organizations.getSettings({ organizationId: resolution.resolved.organizationId });
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        throw new ApiOrganizationAuthenticationError("organization_not_found");
      }
      throw new ApiOrganizationAuthenticationError("internal_error");
    }

    return {
      organizationId: resolution.resolved.organizationId,
      apiKeyId: resolution.resolved.apiKeyId,
      actor: resolution.resolved.userId ? { id: resolution.resolved.userId } : null,
    };
  }

  async authorize(input: {
    request: ApiOrganizationRestAuthenticatedRequest;
    permission: AuthzPermission;
  }): Promise<void> {
    const allowed = await this.authz.hasApiKeyPermission({
      apiKeyId: input.request.apiKeyId,
      userId: input.request.actor?.id ?? null,
      organizationId: input.request.organizationId,
      scope: { type: "org", id: input.request.organizationId },
      permission: input.permission,
    });
    if (!allowed) {
      throw new ApiOrganizationPermissionError(input.permission);
    }
  }

  isAdmin(input: { request: ApiOrganizationRestAuthenticatedRequest }): Promise<boolean> {
    const { request } = input;
    return request.actor
      ? this.apiKeys.isOrgAdmin({
          userId: request.actor.id,
          organizationId: request.organizationId,
        })
      : this.apiKeys.isOrgAdminApiKey({
          apiKeyId: request.apiKeyId,
          organizationId: request.organizationId,
        });
  }

  async complete(input: ApiOrganizationRestSuccessfulResponse): Promise<void> {
    this.apiKeys.markUsed({ id: input.request.apiKeyId });
  }
}

function authenticationDetails(code: OrganizationAuthenticationCode): {
  status: 401 | 500;
  message: string;
  legacyError: "Unauthorized" | "Internal Server Error";
  meta?: Record<string, string>;
} {
  switch (code) {
    case "missing_credentials":
      return {
        status: 401,
        legacyError: "Unauthorized",
        message: "Authentication required. Use Authorization: Bearer <api-key>.",
      };
    case "credential_class_mismatch":
      return {
        status: 401,
        legacyError: "Unauthorized",
        message: "This endpoint needs an organization API key. The key sent is a project API key.",
        meta: { required: "organization_api_key", presented: "project_api_key" },
      };
    case "invalid_credentials":
      return { status: 401, legacyError: "Unauthorized", message: "Invalid credentials." };
    case "organization_not_found":
      return { status: 401, legacyError: "Unauthorized", message: "Organization not found" };
    case "internal_error":
      return {
        status: 500,
        legacyError: "Internal Server Error",
        message: "Authentication service error",
      };
  }
}
