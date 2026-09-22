// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The SCIM feature's application: what its four doors call.
 *
 * Two of them mint and retire provisioning tokens — the settings page over
 * tRPC, and the management REST family an identity team scripts against — a
 * third speaks SCIM 2.0 to an identity provider, and a fourth relays a
 * directory's log stream. Before this, the tRPC door declared a context slice
 * for itself while the REST families took a `scim` resolver and the webhook
 * took the service as a call argument: three descriptions of one bag, none
 * reachable from the others.
 *
 * The provisioning operations are the directory service's own and are reached
 * through it. What this object adds is that they are reached through ONE
 * thing, so a rule about minting a token — which connection it binds to, what
 * is returned once and never again — and a rule about which tenant a push
 * provisions have one place to live rather than four.
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import {
  SCIM_REQUEST_FEED_LIMIT,
  ScimApi,
  ScimProtocolError,
  scimConfig,
  scimSecrets,
  type IssuedScimToken,
  type ScimApi as ScimApiContract,
  type ScimCreateGroupRequest,
  type ScimCreateUserRequest,
  type ScimDirectoryScope,
  type ScimError,
  type OrganizationReconciliation,
  type ScimGroup,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimConnectionRequestsInput,
  type ScimRefusalReason,
  type ScimRequestEntry,
  type ScimReconciliationScope,
  type ScimReplaceGroupRequest,
  type ScimServerConfig,
  type ScimService,
  type ScimDeliveryAdmission,
  type ScimDirectoryConnection,
  type ScimTokenAuditEntry,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import {
  ENTERPRISE_FEATURE_ERRORS,
  EntitlementApi,
  isEnterpriseTier,
} from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { UserApi } from "@langwatch/user-contract";

import { PrismaScimRepository } from "../repositories/prisma/prisma.scim.repository.ts";
import { PostgresScimService } from "../services/postgres-scim.service.ts";
import { ScimConnectionRetirementService } from "../services/scim-connection-retirement.service.ts";
import { ScimConnectionsService } from "../services/scim-connections.service.ts";
import { ScimDirectoryStreamService } from "../services/scim-directory-stream.service.ts";
import { ScimReconciliationService } from "../services/scim-reconciliation.service.ts";
import type { ScimSyncLifecycle } from "./scim.members.ts";

/**
 * The durable directory-sync history (D08): not drawn from `reads()`, because
 * it states facts on Identity's own `ScimSync` aggregate through guard and
 * ledger primitives Identity's public API does not expose to a peer module
 * today. A process composes one with `createScimSyncLifecycle`
 * (`scim.server.ts`) and supplies it here the same way
 * `ProjectInfrastructure.topicClustering` reaches `ProjectApp` in
 * `project.app.ts`: a member that is neither a process read nor a peer
 * capability, so it travels beside `reads()` rather than through it.
 */
export type ScimBespokeMembers = Readonly<{
  lifecycle: ScimSyncLifecycle;
}>;

type ScimSetup = FeatureSetup<
  typeof ScimApp.dependencies,
  ScimBespokeMembers & MembersRead<typeof ScimApp.reads>,
  ScimServerConfig
>;

/** The protocol's own document for one refusal, at one status. */
function scimRefusal(status: number, detail: string): ScimProtocolError {
  const response: ScimError = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };

  return new ScimProtocolError(response);
}

/**
 * What a status means, when nothing said otherwise (ADR-126).
 *
 * The slug exists so a reader branches on it rather than on our prose. A 403
 * is "you may not", and a lapsed plan is only one of the ways to earn one —
 * the credential seam names that cause itself, and anything else that answers
 * 403 says so without naming a cause it does not know.
 */
function refusalReasonFor(status: number): ScimRefusalReason {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400) return "invalid_resource";
  if (status === 429) return "rate_limited";
  if (status === 405 || status === 415 || status === 501) return "unsupported";

  return "internal_error";
}

/** What the caller was answered, read off the refusal they were given. */
function servedStatus(error: unknown, whenHandled: number): number {
  return error instanceof ScimProtocolError ? Number(error.response.status) : whenHandled;
}

/**
 * The resource a request asked for, as a person reads it.
 *
 * Never the raw path: it carries ids and query strings, and this string is
 * rendered on a settings page rather than matched by a machine. An id
 * collapses to `:id` so "the same thing, forty times" reads as forty rows of
 * one shape instead of forty different-looking ones.
 */
function scimResourceOf(path: string): string {
  const tail = path.replace(/^.*\/scim\/v2\/?/, "").split("?")[0] ?? "";
  if (!tail) return "/";

  const [head, ...rest] = tail.split("/");

  return rest.length > 0 ? `${head}/:id` : (head ?? "/");
}

/** The bearer a request presented, or nothing where it presented none. */
function findBearer(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice(7).trim();

  return token.length > 0 ? token : null;
}

export class ScimApp implements ScimApiContract {
  static readonly contract = ScimApi;
  static readonly dependencies = {
    authorization: AuthzApi,
    users: UserApi,
    governance: GovernanceRestApi,
    entitlements: EntitlementApi,
    auditLog: AuditLogApi,
    identity: IdentityApi,
    organization: OrganizationApi,
  };
  static readonly config = scimConfig;
  static readonly secrets = scimSecrets;
  static readonly reads = reads("prisma");

  readonly #scim: ScimService;
  readonly #connections: ScimConnectionsService;
  readonly #entitlements: Pick<EntitlementApi, "getActivePlan">;
  readonly #auditLog: Pick<AuditLogApi, "record">;
  readonly #webhook: ScimDirectoryStreamService;
  readonly #retirement: ScimConnectionRetirementService;
  readonly #reconciliation: ScimReconciliationService;

  private constructor(options: {
    scim: ScimService;
    connections: ScimConnectionsService;
    reconciliation: ScimReconciliationService;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    auditLog: Pick<AuditLogApi, "record">;
    webhookSecret: () => string | undefined;
  }) {
    this.#scim = options.scim;
    this.#connections = options.connections;
    this.#reconciliation = options.reconciliation;
    this.#entitlements = options.entitlements;
    this.#auditLog = options.auditLog;
    this.#retirement = ScimConnectionRetirementService.create({
      connections: options.connections,
      tokens: options.scim,
    });
    this.#webhook = ScimDirectoryStreamService.create({
      scim: options.scim,
      retirement: this.#retirement,
      webhookSecret: options.webhookSecret,
    });
  }

  static async create(setup: ScimSetup): Promise<ScimApp> {
    const { dependencies, members, config, secrets } = setup;
    const auth0WebhookSecret = await secrets.into(scimSecrets.auth0WebhookSecret, (value) => value);
    const scim = PostgresScimService.create({
      repository: PrismaScimRepository.create(members.prisma),
      writer: dependencies.authorization,
      users: dependencies.users,
      governance: dependencies.governance,
      organization: dependencies.organization,
      entitlements: dependencies.entitlements,
      lifecycle: members.lifecycle,
      provenOffboarding: config.provenOffboarding,
    });

    return ScimApp.createWithService({
      scim,
      connections: ScimConnectionsService.create(dependencies.identity),
      reconciliation: ScimReconciliationService.create({
        identity: dependencies.identity,
        grants: dependencies.authorization,
        people: dependencies.users,
        directory: scim,
      }),
      entitlements: dependencies.entitlements,
      auditLog: dependencies.auditLog,
      webhookSecret: () => auth0WebhookSecret,
    });
  }

  /**
   * Split from {@link create} so a test can substitute a fake SCIM service
   * and the two peers the doors exercise, without a real database or the
   * three peers `create` resolves only to build the service.
   */
  static createWithService(options: {
    scim: ScimService;
    connections: ScimConnectionsService;
    reconciliation: ScimReconciliationService;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    auditLog: Pick<AuditLogApi, "record">;
    webhookSecret: () => string | undefined;
  }): ScimApp {
    return new ScimApp(options);
  }

  // ── The organization's provisioning tokens ───────────────────────────────

  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    return this.#scim.listTokens(input);
  }

  findConnections(input: { organizationId: string }): Promise<ScimDirectoryConnection[]> {
    return this.#connections.findConnections(input);
  }

  generateToken(input: {
    organizationId: string;
    connectionId?: string | undefined;
    description?: string | undefined;
  }): Promise<IssuedScimToken> {
    return this.#scim.generateToken(input);
  }

  revokeToken(input: { organizationId: string; tokenId: string }): Promise<{ success: true }> {
    return this.#scim.revokeToken(input);
  }

  async isEnterpriseEntitled(input: { organizationId: string }): Promise<boolean> {
    const plan = await this.#entitlements.getActivePlan({ organizationId: input.organizationId });

    return isEnterpriseTier(plan.type);
  }

  recordTokenAudit(entry: ScimTokenAuditEntry): void {
    void this.#auditLog.record({
      userId: entry.actorId,
      organizationId: entry.organizationId,
      action: entry.action,
      args: JSON.parse(JSON.stringify(entry.args)),
    });
  }

  // ── The directory credential ─────────────────────────────────────────────

  async authenticateDirectory(input: {
    authorization: string | null;
    method?: string | undefined;
    path?: string | undefined;
  }): Promise<ScimDirectoryScope> {
    const token = findBearer(input.authorization);

    // Unattributable by construction — there is no organization to file it
    // under, and a table unauthenticated traffic can write is a table anybody
    // can fill (ADR-126). `ScimToken.lastUsedAt` staying null is the answer.
    if (!token) throw scimRefusal(401, "Bearer token is required");

    const entitlement = await this.#scim.verifyToken({ token });

    if (entitlement.status === "invalid_token") {
      throw scimRefusal(401, "Bearer token is not valid");
    }

    if (entitlement.status === "plan_not_entitled") {
      // Recorded, unlike the 401s above: a lapsed plan is a credential we
      // recognize, so we know whose page it belongs on.
      this.#refused(input, entitlement, 403, "plan_not_entitled", ENTERPRISE_FEATURE_ERRORS.SCIM);

      throw scimRefusal(403, ENTERPRISE_FEATURE_ERRORS.SCIM);
    }

    // The token reaches no further than the connection it was issued against
    // reaches: one the organization has taken away provisions nothing, and
    // the refusal retires the rest of that connection's tokens with it.
    if (
      entitlement.connectionId !== null &&
      !(await this.#retirement.admits({
        organizationId: entitlement.organizationId,
        connectionId: entitlement.connectionId,
      }))
    ) {
      this.#refused(
        input,
        entitlement,
        401,
        "unauthorized",
        "This directory token can no longer write through its single sign-on connection",
      );

      throw scimRefusal(401, "Bearer token is not valid");
    }

    return {
      id: entitlement.id,
      organizationId: entitlement.organizationId,
      connectionId: entitlement.connectionId,
    };
  }

  verifyToken(input: { token: string }): Promise<ScimTokenEntitlement> {
    return this.#scim.verifyToken(input);
  }

  getDirectoryReconciliation(input: ScimReconciliationScope): Promise<OrganizationReconciliation> {
    return this.#reconciliation.getAll(input);
  }

  async findDirectoryRequests(input: ScimConnectionRequestsInput): Promise<ScimRequestEntry[]> {
    const entries = await this.#scim.findRequestLog({ ...input, limit: SCIM_REQUEST_FEED_LIMIT });

    return entries.map(({ organizationId: _tenant, connectionId: _connection, ...entry }) => entry);
  }

  /**
   * A refusal the credential itself earned, filed against the connection it
   * was meant for — but only where the door said what was being asked for.
   * Naming the resource is the whole of what makes the row readable.
   */
  #refused(
    asked: { method?: string | undefined; path?: string | undefined },
    scope: { organizationId: string; connectionId: string | null },
    status: number,
    reason: ScimRefusalReason,
    detail: string,
  ): void {
    if (asked.method === void 0 || asked.path === void 0) return;

    void this.#scim.recordRequest({
      organizationId: scope.organizationId,
      // The token names its connection even when the plan has lapsed, and the
      // only reader queries by a concrete connection id. Filed under null,
      // this row would be written where nobody could ever read it.
      connectionId: scope.connectionId,
      method: asked.method,
      resource: scimResourceOf(asked.path),
      status,
      reason,
      detail,
    });
  }

  // ── SCIM 2.0 users ───────────────────────────────────────────────────────

  listUsers(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
  }): Promise<ScimListResponse<ScimUser>> {
    return this.#served(input, "GET", "Users", 200, () => this.#scim.listUsers(input));
  }

  createUser(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser> {
    return this.#served(input, "POST", "Users", 201, () => this.#scim.createUser(input));
  }

  getUser(input: { organizationId: string; id: string }): Promise<ScimUser> {
    return this.#served(input, "GET", "Users/:id", 200, () => this.#scim.getUser(input));
  }

  replaceUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser> {
    return this.#served(input, "PUT", "Users/:id", 200, () => this.#scim.replaceUser(input));
  }

  updateUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimUser> {
    return this.#served(input, "PATCH", "Users/:id", 200, () => this.#scim.updateUser(input));
  }

  deleteUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
  }): Promise<void> {
    return this.#served(input, "DELETE", "Users/:id", 204, () => this.#scim.deleteUser(input));
  }

  /**
   * One served request, filed as evidence once it has been answered (ADR-126).
   *
   * The record is an observation of something that already happened, so it is
   * never awaited and never fails the request: `recordRequest` swallows and
   * logs its own failure, and a refusal keeps the refusal the caller was owed.
   */
  async #served<T>(
    scope: { organizationId: string; connectionId?: string | null | undefined },
    method: string,
    resource: string,
    answered: number,
    work: () => Promise<T>,
  ): Promise<T> {
    const request = {
      organizationId: scope.organizationId,
      connectionId: scope.connectionId ?? null,
      method,
      resource,
    };
    try {
      const served = await work();
      void this.#scim.recordRequest({ ...request, status: answered, reason: null, detail: null });

      return served;
    } catch (error) {
      const status = servedStatus(error, 500);
      void this.#scim.recordRequest({
        ...request,
        status,
        reason: refusalReasonFor(status),
        detail: error instanceof ScimProtocolError ? (error.response.detail ?? null) : null,
      });

      throw error;
    }
  }

  // ── SCIM 2.0 groups ──────────────────────────────────────────────────────

  listGroups(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimListResponse<ScimGroup>> {
    return this.#served(input, "GET", "Groups", 200, () => this.#scim.listGroups(input));
  }

  createGroup(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup> {
    return this.#served(input, "POST", "Groups", 201, () => this.#scim.createGroup(input));
  }

  getGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimGroup> {
    return this.#served(input, "GET", "Groups/:id", 200, () => this.#scim.getGroup(input));
  }

  replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup> {
    return this.#served(input, "PUT", "Groups/:id", 200, () => this.#scim.replaceGroup(input));
  }

  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup> {
    return this.#served(input, "PATCH", "Groups/:id", 200, () => this.#scim.updateGroup(input));
  }

  deleteGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
  }): Promise<void> {
    return this.#served(input, "DELETE", "Groups/:id", 204, () => this.#scim.deleteGroup(input));
  }

  // ── The directory's log stream ───────────────────────────────────────────

  admitDirectoryDelivery(delivery: {
    body: string;
    signature: string | null;
    authorization: string | null;
  }): Promise<ScimDeliveryAdmission> {
    return this.#webhook.admit(delivery);
  }

  relayDirectoryEvents(input: { organizationId: string; events: unknown[] }): Promise<void> {
    return this.#webhook.relay(input);
  }
}
