import type { Entitlements } from "@langwatch/api/access";
import type {
  ApiDoor,
  RestAuditSink,
  RestCaller,
  RestIdentity,
  TrpcAuditSink,
} from "@langwatch/api/hosting";
import {
  ForbiddenError,
  recordKeyCredential,
  recordOrganizationCredential,
  recordProjectCredential,
} from "@langwatch/api/rest";
import { recordAuditLogCommandSchema, type AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { Actor, Authorization } from "@langwatch/authorization";
import {
  AuthzScopeNotFoundError,
  type AuthzApi,
  type AuthzPrincipalRef,
} from "@langwatch/authz-contract";
import {
  EnterprisePlanRequiredError,
  isEnterpriseTier,
  type EntitlementApi,
} from "@langwatch/entitlement-contract";
import {
  IdentityMfaEnrollmentRequiredError,
  type IdentityApi,
  type OrganizationMfaStanding,
} from "@langwatch/identity-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import {
  ApiRestCredentialsService,
  type ApiRestCredentialPeers,
  type ApiKeyDoorCredential,
  type ApiOrganizationCredential,
  type ApiProjectCredential,
} from "./api-rest-credentials.service.ts";
import { BrowserSessionVerificationService } from "./browser-session-verification.service.ts";

/** Main's refusal for a plan without the webhook platform, byte for byte. */
const WEBHOOK_ENDPOINTS_REFUSAL =
  "The billing events API is an enterprise feature; this organization's plan does not include it.";

export type ApiDoorPeers = Readonly<{
  sessions: Pick<AuthApi, "verifyBrowserSession" | "resolveBrowserSession">;
  /** Whether this deployment offers two-step verification; off, the gate asks nothing. */
  twoStep: Pick<AuthApi, "offersTwoStepVerification">;
  /** Where one person stands with one organization's second-factor requirement (Q184). */
  identity: Pick<IdentityApi, "getOrganizationMfaStanding">;
  apiKeys: ApiRestCredentialPeers["apiKeys"];
  /** Where a project-bound CLI access token is read back to its person and project. */
  cliProjects: ApiRestCredentialPeers["cliProjects"];
  /** The decisions both transports authorize through, and the key ceilings the key doors ask. */
  authz: Pick<
    ApiDoor["authz"],
    "getDecision" | "getProjectAnyDecision" | "checkScopeLineage" | "getSessionVersion"
  > &
    ApiRestCredentialPeers["authz"] &
    Pick<AuthzApi, "getScope" | "can" | "authorize">;
  organizations: Pick<
    OrganizationApi,
    "getSettings" | "getOrganizationIdByTeamId" | "findPersonalTeamOwners"
  >;
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
  readonly #projectCredentials = new WeakMap<RestCaller, ApiProjectCredential>();
  readonly #standings = new Map<string, Promise<OrganizationMfaStanding>>();

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
  #authorize(): Required<ApiDoor["authz"]> {
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
      organizationOf: async (scope) => {
        const ids = scope.tier === "project" ? { projectId: scope.id } : { teamId: scope.id };
        const resolved = await authz.getScope(ids).catch((error: unknown) => {
          if (AuthzScopeNotFoundError.is(error)) return null;
          throw error;
        });
        return resolved?.type === scope.tier ? resolved.organizationId : null;
      },
      projectKindOf: (projectId) => this.#projectKindOf(projectId),
      authorization: (input) => this.#mintProof(input),
      assertSecondFactor: (input) => this.#assertSecondFactor(input),
    };
  }

  /** A project's kind, read with its scope (ADR-177); an unknown project has none. */
  async #projectKindOf(projectId: string): Promise<string | null> {
    const resolved = await this.#peers.authz.getScope({ projectId }).catch((error: unknown) => {
      if (AuthzScopeNotFoundError.is(error)) return null;
      throw error;
    });

    return resolved?.type === "project" ? (resolved.kind ?? null) : null;
  }

  /** The route's sealed proof, minted by AuthzApi.authorize after the door admitted the call. */
  async #mintProof({
    actor,
    permission,
    projectId,
    purpose,
  }: Parameters<NonNullable<ApiDoor["authz"]["authorization"]>>[0]): Promise<Authorization> {
    const { authz } = this.#peers;
    const scope = await authz.getScope({ projectId });
    if (scope.type !== "project") throw new Error(`${projectId} resolved to no project`);

    const { authorization } = await authz.authorize({
      principal: proofPrincipalOf(actor),
      permission,
      scope,
      proof: { actor, purpose },
    });
    if (!authorization) throw new Error("authz minted no proof for a project read");

    return authorization;
  }

  /**
   * Main's mfa-gate: the flag before any read, the standing next, and only a refusal pays for
   * the personal-workspace read, since nobody's own workspace is held by an employer's rule.
   */
  async #assertSecondFactor({
    userId,
    sessionId,
    organizationId,
    scope,
  }: Parameters<NonNullable<ApiDoor["authz"]["assertSecondFactor"]>>[0]): Promise<void> {
    if (!this.#peers.twoStep.offersTwoStepVerification()) return;

    const standing = await this.#standing({ userId, sessionId, organizationId });
    if (standing.satisfaction.satisfied) return;
    if (await this.#isPersonal({ organizationId, scope })) return;

    throw new IdentityMfaEnrollmentRequiredError(
      `organization ${organizationId} requires a second factor and ${userId} cannot yet prove one`,
    );
  }

  /**
   * A batch over several scopes of one organization reads the standing once: concurrent askers
   * share one read, and nothing is kept after it settles, so a later request reads afresh. Only
   * the standing is shared; the scope-dependent exemption stays with each asker.
   */
  #standing({
    userId,
    sessionId,
    organizationId,
  }: {
    userId: string;
    sessionId: string | null;
    organizationId: string;
  }): Promise<OrganizationMfaStanding> {
    const key = JSON.stringify([userId, sessionId, organizationId]);
    const known = this.#standings.get(key);
    if (known) return known;

    const read = this.#peers.identity
      .getOrganizationMfaStanding({ userId, organizationId, sessionId })
      .finally(() => this.#standings.delete(key));
    this.#standings.set(key, read);

    return read;
  }

  /** A personal project always hangs from its owner's personal team, so the team answers. */
  async #isPersonal({
    organizationId,
    scope,
  }: {
    organizationId: string;
    scope: Readonly<{ tier: "organization" | "project" | "team"; id: string }>;
  }): Promise<boolean> {
    if (scope.tier === "organization") return false;

    const teamId =
      scope.tier === "team"
        ? scope.id
        : await this.#peers.authz.getScope({ projectId: scope.id }).then(
            (resolved) => (resolved.type === "project" ? resolved.teamId : null),
            (error: unknown) => {
              if (AuthzScopeNotFoundError.is(error)) return null;
              throw error;
            },
          );
    if (teamId === null) return false;

    const personal = await this.#peers.organizations.findPersonalTeamOwners({
      organizationId,
      teamIds: [teamId],
    });

    return personal.length > 0;
  }

  #projectDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permissions, keyKinds }) =>
        this.#projectCaller(
          request,
          await this.#credentials.authenticate({
            request,
            permissions,
            ...(keyKinds ? { keyKinds } : {}),
          }),
        ),
      identify: async ({ request }) =>
        this.#projectCaller(request, await this.#credentials.identify({ request })),
      authorize: ({ caller, permission, target }) => {
        if (target.tier !== "project") {
          throw new Error(
            `The project door answers a route-scoped permission at a project, and ` +
              `"${permission}" was asked at a ${target.tier}`,
          );
        }
        const credential = this.#projectCredentials.get(caller);
        if (!credential) throw new Error("The project door authorized a caller it did not resolve");

        return this.#credentials.authorizeProjectRoute({
          credential,
          permission,
          projectId: target.id,
        });
      },
    };
  }

  #projectCaller(request: Request, credential: ApiProjectCredential): RestCaller {
    const caller = projectCaller(request, credential);
    this.#projectCredentials.set(caller, credential);

    return caller;
  }

  #organizationDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permissions }) =>
        this.#organizationCaller(
          request,
          await this.#credentials.authenticateOrganization({ request, permissions }),
        ),
      identify: async ({ request }) =>
        this.#organizationCaller(
          request,
          await this.#credentials.identifyOrganization({ request }),
        ),
      authorize: ({ caller, permission, target }) => {
        if (target.tier !== "project" && target.tier !== "team") {
          throw new Error(
            `The organization door answers a route-scoped permission at a project or a team, ` +
              `and "${permission}" was asked at a ${target.tier}`,
          );
        }
        const credential = this.#callerCredentials.get(caller);
        if (!credential) {
          throw new Error("The organization door authorized a caller it did not resolve");
        }
        if (target.tier === "team") {
          return this.#credentials.authorizeOrganizationTeamRoute({
            credential,
            permission,
            teamId: target.id,
          });
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
      authenticate: async ({ request, permissions, reach }) =>
        keyCaller(
          request,
          await this.#credentials.authenticateKey({
            request,
            permissions,
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
      holds: async ({ entitlement, scope }) => {
        if (scope.tier === "project") {
          throw new Error(`No plan gate reads a project's organization yet (${scope.id})`);
        }
        const organizationId =
          scope.tier === "organization"
            ? scope.id
            : await organizations.getOrganizationIdByTeamId({ teamId: scope.id });
        const plan = await plans.getActivePlan({ organizationId });

        // ADR-072: billing events are sold under the webhook platform's own plan flag.
        return entitlement === "webhook_endpoints"
          ? plan.webhookEndpointsEnabled === true
          : isEnterpriseTier(plan.type);
      },
      refusal: ({ entitlement, feature }) =>
        entitlement === "webhook_endpoints"
          ? new ForbiddenError(WEBHOOK_ENDPOINTS_REFUSAL)
          : new EnterprisePlanRequiredError(
              feature ?? "This operation requires an Enterprise plan",
            ),
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

/** Whom a door-minted proof is asked for: the person (impersonated, as decided) or the key. */
function proofPrincipalOf(actor: Actor): AuthzPrincipalRef {
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "apiKey", id: actor.id };
  throw new Error(`a ${actor.type} actor reached a door that mints a route proof`);
}
