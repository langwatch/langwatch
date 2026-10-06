import type { Entitlements } from "@langwatch/api/access";
import type {
  ApiDoor,
  RestAuditSink,
  RestCaller,
  RestIdentity,
  TrpcAuditSink,
} from "@langwatch/api/hosting";
import {
  recordKeyCredential,
  recordOrganizationCredential,
  recordProjectCredential,
} from "@langwatch/api/rest";
import { recordAuditLogCommandSchema, type AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";
import {
  EnterprisePlanRequiredError,
  isEnterpriseTier,
  type EntitlementApi,
} from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import {
  ApiRestCredentialsService,
  type ApiRestCredentialPeers,
  type ApiKeyDoorCredential,
  type ApiOrganizationCredential,
  type ApiProjectCredential,
} from "./api-rest-credentials.service.ts";
import { BrowserSessionVerificationService } from "./browser-session-verification.service.ts";

export type ApiDoorPeers = Readonly<{
  sessions: Pick<AuthApi, "verifyBrowserSession" | "resolveBrowserSession">;
  apiKeys: ApiRestCredentialPeers["apiKeys"];
  /** Where a project-bound CLI access token is read back to its person and project. */
  cliProjects: ApiRestCredentialPeers["cliProjects"];
  /** The decisions both transports authorize through, and the key ceilings the key doors ask. */
  authz: ApiDoor["authz"] & ApiRestCredentialPeers["authz"] & Pick<AuthzApi, "getScope" | "can">;
  organizations: Pick<OrganizationApi, "getSettings" | "getOrganizationIdByTeamId">;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  auditLog: Pick<AuditLogApi, "record">;
}>;

/** The API door auth binds for the process: who is calling, and what they may do (record §8). */
export class ApiDoorService {
  static create(peers: ApiDoorPeers): ApiDoorService {
    return new ApiDoorService(peers);
  }

  readonly #peers: ApiDoorPeers;
  readonly #credentials: ApiRestCredentialsService;
  readonly #sessions: BrowserSessionVerificationService;
  readonly #callerCredentials = new WeakMap<RestCaller, ApiOrganizationCredential["resolved"]>();

  private constructor(peers: ApiDoorPeers) {
    this.#peers = peers;
    this.#credentials = ApiRestCredentialsService.create({
      apiKeys: peers.apiKeys,
      authz: peers.authz,
      cliProjects: peers.cliProjects,
      organizations: peers.organizations,
    });
    this.#sessions = BrowserSessionVerificationService.create({ sessions: peers.sessions });
  }

  door(): ApiDoor {
    return {
      sessions: async (request) => {
        const answer = await this.#sessions.verify(request);
        return answer.kind === "caller" ? answer.caller : null;
      },
      authz: this.#authorize(),
      identities: {
        project: this.#projectDoor(),
        organization: this.#organizationDoor(),
        api_key: this.#keyDoor(),
      },
      entitlements: this.#planEntitlements(),
      audit: { rest: this.#restAudit(), trpc: this.#trpcAudit() },
    };
  }

  /** The decisions both transports ask, and the platform grant asked of the operator (E4). */
  #authorize(): ApiDoor["authz"] {
    const authz = this.#peers.authz;

    return {
      getDecision: (input) => authz.getDecision(input),
      getProjectAnyDecision: (input) => authz.getProjectAnyDecision(input),
      checkScopeLineage: (input) => authz.checkScopeLineage(input),
      getSessionVersion: (input) => authz.getSessionVersion(input),
      getPlatformDecision: async ({ userId, permission }) => ({
        permitted: await authz.can({
          principal: { type: "user", id: userId },
          permission,
          scope: { type: "platform" },
        }),
      }),
    };
  }

  #projectDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission }) =>
        projectCaller(request, await this.#credentials.authenticate({ request, permission })),
      identify: async ({ request }) =>
        projectCaller(request, await this.#credentials.identify({ request })),
    };
  }

  #organizationDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission }) =>
        this.#organizationCaller(
          request,
          await this.#credentials.authenticateOrganization({ request, permission }),
        ),
      identify: async ({ request }) =>
        this.#organizationCaller(
          request,
          await this.#credentials.identifyOrganization({ request }),
        ),
      authorize: ({ caller, permission, target }) => {
        if (target.tier !== "project") {
          throw new Error(
            `The organization door answers a route-scoped permission at a project, and ` +
              `"${permission}" was asked at a ${target.tier}`,
          );
        }
        const credential = this.#callerCredentials.get(caller);
        if (!credential) {
          throw new Error("The organization door authorized a caller it did not resolve");
        }

        return this.#credentials.authorizeOrganizationRoute({
          credential,
          permission,
          projectId: target.id,
        });
      },
    };
  }

  #organizationCaller(request: Request, credential: ApiOrganizationCredential): RestCaller {
    recordOrganizationCredential(request, credential.resolved);
    const caller = ownedCaller({
      userId: credential.resolved.userId,
      scope: { tier: "organization", id: credential.resolved.organizationId },
      markUsed: credential.markUsed,
    });
    this.#callerCredentials.set(caller, credential.resolved);

    return caller;
  }

  /** Any API key, with no project demanded: a permission is asked at the key's own reach. */
  #keyDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission, reach }) =>
        keyCaller(
          request,
          await this.#credentials.authenticateKey({
            request,
            permission,
            ...(reach ? { reach } : {}),
          }),
        ),
      identify: async ({ request }) =>
        keyCaller(request, await this.#credentials.identifyKey({ request })),
    };
  }

  /** Composed here because authz and organization cannot depend on entitlement without a cycle. */
  #planEntitlements(): Entitlements {
    const { entitlements: plans, organizations } = this.#peers;

    return {
      holds: async ({ scope }) => {
        if (scope.tier === "project") {
          throw new Error(`No plan gate reads a project's organization yet (${scope.id})`);
        }
        const organizationId =
          scope.tier === "organization"
            ? scope.id
            : await organizations.getOrganizationIdByTeamId({ teamId: scope.id });

        return isEnterpriseTier((await plans.getActivePlan({ organizationId })).type);
      },
      refusal: ({ feature }) =>
        new EnterprisePlanRequiredError(feature ?? "This operation requires an Enterprise plan"),
    };
  }

  #restAudit(): RestAuditSink {
    const audit = this.#peers.auditLog;

    return {
      record: async (row) => {
        await audit.record({
          userId: row.actorId ?? "anonymous",
          action: row.action,
          args: { ...row.params, scope: row.scope },
          projectId: typeof row.params.projectId === "string" ? row.params.projectId : void 0,
          organizationId:
            typeof row.params.organizationId === "string" ? row.params.organizationId : void 0,
          targetId: row.resultId || void 0,
          error: row.errorCode,
        });
      },
    };
  }

  #trpcAudit(): TrpcAuditSink {
    const audit = this.#peers.auditLog;

    return {
      record: async (entry) => {
        let args: unknown;
        if (entry.args !== void 0) args = JSON.parse(JSON.stringify(entry.args));
        await audit.record(
          recordAuditLogCommandSchema.parse({
            userId: entry.userId,
            action: entry.action,
            args,
            organizationId: entry.organizationId,
            projectId: entry.projectId,
            error: entry.error?.toString(),
            targetKind: entry.targetKind,
            targetId: entry.targetId,
            metadata: entry.metadata,
          }),
        );
      },
      /** The organization holding a project or team; null where authz resolves no such scope. */
      organizationOf: async (scope) => {
        const ids = scope.tier === "project" ? { projectId: scope.id } : { teamId: scope.id };
        const resolved = await this.#peers.authz.getScope(ids).catch((error: unknown) => {
          if (AuthzScopeNotFoundError.is(error)) return null;
          throw error;
        });
        return resolved?.type === scope.tier ? resolved.organizationId : null;
      },
    };
  }
}

function projectCaller(request: Request, credential: ApiProjectCredential): RestCaller {
  recordProjectCredential(request, credential.resolved);
  const { resolved } = credential;
  if (resolved.type === "apiKey" && resolved.userId === null && resolved.isUnattendedRunKey) {
    return {
      actor: { type: "system", name: "unattendedRun" },
      scope: { tier: "project", id: credential.project.id },
      markUsed: credential.markUsed,
    };
  }

  return ownedCaller({
    userId: credential.resolved.type === "legacyProjectKey" ? null : credential.resolved.userId,
    scope: { tier: "project", id: credential.project.id },
    markUsed: credential.markUsed,
  });
}

function keyCaller(request: Request, credential: ApiKeyDoorCredential): RestCaller {
  recordKeyCredential(request, credential.principal);
  const { principal } = credential;

  return ownedCaller({
    userId: principal.kind === "project" ? null : principal.userId,
    scope: { tier: "organization", id: credential.organizationId },
    markUsed: credential.markUsed,
  });
}

/** A key door's caller: its actor is the key's owning user, or none for an unowned key (§8). */
function ownedCaller({
  userId,
  scope,
  markUsed,
}: {
  userId: string | null;
  scope: RestCaller["scope"];
  markUsed: () => void;
}): RestCaller {
  return { actor: userId ? { type: "user", id: userId } : null, scope, markUsed };
}
