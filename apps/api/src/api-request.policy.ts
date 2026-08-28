import {
  AuthzService,
  PermissionDeniedError,
  type AuthzPermission,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import type { ApiActor, ApiAuditEvent, ApiHttpOptions, ApiRequestContext } from "./api.application";

/** Authenticates a web request without coupling the API process to a session implementation. */
export abstract class ApiAuthenticationPort {
  abstract authenticate(request: Request): Promise<ApiActor | null>;
}

/** Records one completed API mutation at the process boundary. */
export abstract class ApiAuditPort {
  abstract record(event: ApiAuditEvent): Promise<void>;
}

/** The small, named request adapter over the complete composed AuthZ service. */
export abstract class ApiAuthorizationPort {
  abstract can(input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<boolean>;

  abstract authorizeProject(input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<void>;

  abstract checkScopeLineage(input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult>;
}

/** Adapts the complete AuthZ contract for the API process's request policy. */
export class AuthzApiAuthorizationAdapter extends ApiAuthorizationPort {
  static create(service: AuthzService): AuthzApiAuthorizationAdapter {
    return new AuthzApiAuthorizationAdapter(service);
  }

  private constructor(private readonly service: AuthzService) {
    super();
  }

  can(input: { userId: string; permission: AuthzPermission; projectId: string }): Promise<boolean> {
    return this.service.hasPermission(input);
  }

  authorizeProject(input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<void> {
    return this.service.authorizeProjectPermission(input);
  }

  checkScopeLineage(input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> {
    return this.service.checkScopeLineage(input);
  }
}

/**
 * The request-policy graph for the standalone API process.
 *
 * Authentication is intentionally technical composition, while project
 * authorization stays with the one composed AuthZ service. Feature adapters
 * receive only the small request context they need.
 */
export class ApiRequestPolicy {
  static create(options: {
    authentication: ApiAuthenticationPort;
    authorization: ApiAuthorizationPort;
    audit?: ApiAuditPort;
  }): ApiRequestPolicy {
    return new ApiRequestPolicy(options.authentication, options.authorization, options.audit);
  }

  private constructor(
    private readonly authentication: ApiAuthenticationPort,
    private readonly authorization: ApiAuthorizationPort,
    private readonly audit: ApiAuditPort | undefined,
  ) {}

  async createContext(request: Request): Promise<ApiRequestContext> {
    const authenticated = await this.authentication.authenticate(request);
    const actor = (): ApiActor => {
      if (!authenticated) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return authenticated;
    };

    const can = async (
      permission: AuthzPermission,
      target: Readonly<{ projectId: string }>,
    ): Promise<boolean> =>
      this.authorization.can({
        userId: actor().id,
        permission,
        projectId: target.projectId,
      });

    return {
      actor,
      can,
      authorize: async (permission, target) => {
        await this.authorization.authorizeProject({
          userId: actor().id,
          permission,
          projectId: target.projectId,
        });
      },
      authorizeScopeLineage: async (input, permission) => {
        const lineage = await this.authorization.checkScopeLineage(asScopeLineageInput(input));
        if (lineage.kind === "consistent") return;

        throw new PermissionDeniedError({
          permission,
          scope: { type: lineage.widest.tier, id: lineage.widest.id },
          denialReason: "no-membership",
        });
      },
    };
  }

  async record(event: ApiAuditEvent): Promise<void> {
    await this.audit?.record(event);
  }

  asHttpOptions(): Pick<ApiHttpOptions, "createContext" | "audit"> {
    return {
      createContext: (request) => this.createContext(request),
      audit: (event) => this.record(event),
    };
  }
}

function asScopeLineageInput(input: unknown): AuthzScopeLineageInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  return {
    projectId: ownValue(input, "projectId"),
    teamId: ownValue(input, "teamId"),
    organizationId: ownValue(input, "organizationId"),
  };
}

function ownValue(input: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(input, key)?.value;
}
