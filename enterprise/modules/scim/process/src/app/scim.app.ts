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
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
  scimSecrets,
  type IssuedScimToken,
  type ScimApi as ScimApiContract,
  type ScimDirectoryScope,
  type ScimError,
  type OrganizationReconciliation,
  type ScimGroup,
  type ScimListResponse,
  type ScimConnectionRequestsInput,
  type ScimRefusalReason,
  type ScimRequestEntry,
  type ScimReconciliationScope,
  type ScimServerConfig,
  type ScimService,
  type ScimDeliveryAdmission,
  type ScimDirectoryConnection,
  type ScimTokenAuditEntry,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
  type ScimUser,
  type DirectoryIdentityRow,
  type ListOversightSyncsInput,
  type OversightConnectionInput,
  type OversightSync,
  type OversightSyncList,
  type RedriveRetiredApplyInput,
  type RedriveRetiredApplyResult,
  type ScimOperator,
} from "@langwatch/enterprise-scim-contract";
import {
  ENTERPRISE_FEATURE_ERRORS,
  EnterprisePlanRequiredError,
  EntitlementApi,
  isEnterpriseTier,
} from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import type { Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";
import type { ZodError, ZodType } from "zod";

import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import { PostgresScimService } from "../services/postgres-scim.service.ts";
import { ScimConnectionRetirementService } from "../services/scim-connection-retirement.service.ts";
import { ScimConnectionsService } from "../services/scim-connections.service.ts";
import { ScimDeprovisionService } from "../services/scim-deprovision.service.ts";
import { ScimDirectoryExternalIdsService } from "../services/scim-directory-external-ids.service.ts";
import { ScimDirectoryStreamService } from "../services/scim-directory-stream.service.ts";
import { ScimOversightService } from "../services/scim-oversight.service.ts";
import { ScimReconciliationService } from "../services/scim-reconciliation.service.ts";
import type { ScimSyncLifecycle } from "./scim.members.ts";

/**
 * The durable directory-sync history (D08): not drawn from `reads()`, because
 * it states facts on Identity's own `ScimSync` aggregate through guard and
 * ledger primitives Identity's public API does not expose to a peer module
 * today. A process composes one with `createScimSyncLifecycle`
 * (`scim.server.ts`) and supplies it beside `reads()`: it is neither a
 * process read nor a peer capability.
 */
export type ScimBespokeMembers = Readonly<{
  lifecycle: ScimSyncLifecycle;
}>;

type ScimSetup = FeatureSetup<
  typeof ScimApp.dependencies,
  ScimBespokeMembers & MembersRead<typeof ScimApp.reads>,
  ScimServerConfig,
  ScimRepositories
>;

const CONNECTION_NOT_WRITABLE =
  "This directory token can no longer write through its single sign-on connection";

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
 * What a refused body is filed as, and what the directory is told: the field
 * paths the schema refused, never the parser's own dump.
 */
function requestBodyRefusal(invalid: ZodError | undefined): {
  reason: ScimRefusalReason;
  detail: string;
} {
  if (!invalid) {
    return { reason: "malformed_body", detail: "The request body could not be read as JSON" };
  }
  const fields = [
    ...new Set(
      invalid.issues.map((issue) => issue.path.join(".")).filter((path) => path.length > 0),
    ),
  ];

  return {
    reason: "invalid_resource",
    detail:
      fields.length > 0
        ? `The resource is not valid: ${fields.join(", ")}`
        : "The resource is not valid",
  };
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

/** The posted document, or null where the text is not JSON, as main's `parseJsonBody` read it. */
function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The bearer a request presented, or nothing where it presented none. */
function findBearer(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;

  const token = authorization.slice(7).trim();

  return token.length > 0 ? token : null;
}

/** Whether this user is on the staff list that may read across every customer. */
type ScimOperatorGate = (userId: string) => Promise<boolean>;

type ScimAppOptions = {
  scim: ScimService;
  connections: ScimConnectionsService;
  directoryExternalIds: ScimDirectoryExternalIdsService;
  reconciliation: ScimReconciliationService;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  auditLog: Pick<AuditLogApi, "record">;
  webhookSecret: () => string | undefined;
  /** Absent in a test that exercises only the protocol doors. */
  oversight?: ScimOversightService;
  operators?: ScimOperatorGate;
};

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
    operators: OpsApi,
  };
  static readonly config = scimConfig;
  static readonly secrets = scimSecrets;
  static readonly reads = reads();

  readonly #scim: ScimService;
  readonly #connections: ScimConnectionsService;
  readonly #directoryExternalIds: ScimDirectoryExternalIdsService;
  readonly #entitlements: Pick<EntitlementApi, "getActivePlan">;
  readonly #auditLog: Pick<AuditLogApi, "record">;
  readonly #webhook: ScimDirectoryStreamService;
  readonly #retirement: ScimConnectionRetirementService;
  readonly #reconciliation: ScimReconciliationService;
  readonly #oversight: ScimOversightService | undefined;
  readonly #operators: ScimOperatorGate | undefined;

  private constructor(options: ScimAppOptions) {
    this.#scim = options.scim;
    this.#oversight = options.oversight;
    this.#operators = options.operators;
    this.#connections = options.connections;
    this.#directoryExternalIds = options.directoryExternalIds;
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
    const { dependencies, members, config, secrets, repositories } = setup;
    const auth0WebhookSecret = await secrets.into(scimSecrets.auth0WebhookSecret, (value) => value);
    const scim = PostgresScimService.create({
      repository: repositories.scim,
      writer: dependencies.authorization,
      users: dependencies.users,
      governance: dependencies.governance,
      organization: dependencies.organization,
      entitlements: dependencies.entitlements,
      lifecycle: members.lifecycle,
      provenOffboarding: config.provenOffboarding,
    });

    const connections = ScimConnectionsService.create(dependencies.identity);

    return ScimApp.createWithService({
      scim,
      connections,
      directoryExternalIds: ScimDirectoryExternalIdsService.create({
        connections,
        identities: repositories.scim,
      }),
      reconciliation: ScimReconciliationService.create({
        identity: dependencies.identity,
        grants: dependencies.authorization,
        people: dependencies.users,
        directory: scim,
      }),
      entitlements: dependencies.entitlements,
      auditLog: dependencies.auditLog,
      webhookSecret: () => auth0WebhookSecret,
      oversight: ScimOversightService.create({
        syncs: () => dependencies.identity.scimSyncReads(),
        organizations: dependencies.organization,
        identities: repositories.scim,
        lifecycle: members.lifecycle,
        deprovision: ScimDeprovisionService.create({
          grants: dependencies.authorization,
          lifecycle: members.lifecycle,
          organization: dependencies.organization,
        }),
      }),
      operators: async (userId) => {
        const profile = await dependencies.users.findById({ id: userId });
        return dependencies.operators.isAdmin({ email: profile?.email });
      },
    });
  }

  /**
   * Split from {@link create} so a test can substitute a fake SCIM service
   * and the two peers the doors exercise, without a real database or the
   * three peers `create` resolves only to build the service.
   */
  static createWithService(options: ScimAppOptions): ScimApp {
    return new ScimApp(options);
  }

  /** Drops recorded requests past their retention window; the worker's sweep. */
  sweepExpiredRequests(input: { now: Instant }): Promise<number> {
    return this.#scim.sweepExpiredRequests(input);
  }

  // ── The organization's provisioning tokens ───────────────────────────────

  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    return this.#scim.listTokens(input);
  }

  findConnections(input: { organizationId: string }): Promise<ScimDirectoryConnection[]> {
    return this.#connections.findConnections(input);
  }

  findDirectoryExternalIds(input: {
    organizationId: string;
  }): Promise<{ userId: string; externalId: string }[]> {
    return this.#directoryExternalIds.findForOrganization(input);
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
      this.#refused({
        asked: input,
        scope: entitlement,
        status: 403,
        reason: "plan_not_entitled",
        detail: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      throw scimRefusal(403, ENTERPRISE_FEATURE_ERRORS.SCIM);
    }

    // The token reaches no further than the connection it was issued against
    // reaches, checked before the token is marked used, as main did.
    if (
      entitlement.connectionId !== null &&
      !(await this.#retirement.admits({
        organizationId: entitlement.organizationId,
        connectionId: entitlement.connectionId,
      }))
    ) {
      this.#refused({
        asked: input,
        scope: entitlement,
        status: 403,
        reason: "forbidden",
        detail: CONNECTION_NOT_WRITABLE,
      });

      throw scimRefusal(403, CONNECTION_NOT_WRITABLE);
    }

    await this.#scim.recordTokenUse({ tokenId: entitlement.id });

    return {
      id: entitlement.id,
      organizationId: entitlement.organizationId,
      connectionId: entitlement.connectionId,
    };
  }

  verifyToken(input: { token: string }): Promise<ScimTokenEntitlement> {
    return this.#scim.verifyToken(input);
  }

  /** Plan-gated, unlike the request log: main's reconciliation read asks the plan. */
  async getDirectoryReconciliation(
    input: ScimReconciliationScope,
  ): Promise<OrganizationReconciliation> {
    if (!(await this.isEnterpriseEntitled(input))) throw new EnterprisePlanRequiredError("SCIM");

    return this.#reconciliation.getAll(input);
  }

  async findDirectoryRequests(input: ScimConnectionRequestsInput): Promise<ScimRequestEntry[]> {
    const entries = await this.#scim.findRequestLog({ ...input, limit: SCIM_REQUEST_FEED_LIMIT });

    return entries.map(({ organizationId: _tenant, connectionId: _connection, ...entry }) => entry);
  }

  // ── The platform operator's oversight (ADR-122) ─────────────────────────

  listOversightSyncs(input: ListOversightSyncsInput, by: ScimOperator): Promise<OversightSyncList> {
    return this.#overseen({
      by,
      action: "getAll",
      args: { page: input.page },
      act: (oversight) => oversight.list(input),
    });
  }

  findOversightSync(input: OversightConnectionInput, by: ScimOperator): Promise<OversightSync[]> {
    return this.#overseen({
      by,
      action: "getById",
      args: { ...input },
      act: (oversight) => oversight.find(input),
    });
  }

  findDirectoryIdentities(
    input: OversightConnectionInput,
    by: ScimOperator,
  ): Promise<DirectoryIdentityRow[]> {
    return this.#overseen({
      by,
      action: "directoryIdentities",
      args: { ...input },
      act: (oversight) => oversight.findDirectoryIdentities(input),
    });
  }

  redriveRetiredApply(
    input: RedriveRetiredApplyInput,
    by: ScimOperator,
  ): Promise<RedriveRetiredApplyResult> {
    return this.#overseen({
      by,
      action: "redriveRetiredApply",
      args: { ...input },
      act: (oversight, operator) => oversight.redriveRetiredApply({ ...input, operator }),
    });
  }

  /**
   * Gate, then record, then act: the record lands before the act so an act
   * that then failed is still in the trail. Anyone off the staff list gets a
   * 404 that says nothing about why; an impersonator is checked, not the user.
   */
  async #overseen<T>({
    by,
    action,
    args,
    act,
  }: {
    by: ScimOperator;
    action: string;
    args: Record<string, string | number>;
    act: (oversight: ScimOversightService, operator: { userId: string }) => Promise<T>;
  }): Promise<T> {
    const userId = by.impersonatorId ?? by.id;
    const oversight = this.#oversight;
    const isOperator = this.#operators ? await this.#operators(userId) : false;
    if (!oversight || !isOperator) throw new AdminSurfaceHiddenError();
    await this.#auditLog.record({
      userId,
      action: `scimOversight.${action}`,
      args: { ...args },
      targetKind: "scimSync",
      ...(typeof args.connectionId === "string" ? { targetId: args.connectionId } : {}),
    });

    return act(oversight, { userId });
  }

  /**
   * A refusal the credential itself earned, filed against the connection it
   * was meant for — but only where the door said what was being asked for.
   * Naming the resource is the whole of what makes the row readable.
   */
  #refused({
    asked,
    scope,
    status,
    reason,
    detail,
  }: {
    asked: { method?: string | undefined; path?: string | undefined };
    scope: { organizationId: string; connectionId: string | null };
    status: number;
    reason: ScimRefusalReason;
    detail: string;
  }): void {
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

  /**
   * The posted text as the resource it must be, read after the door as main
   * read it. A body that is not JSON, or not a resource we accept, is filed on
   * the request log (ADR-126) and refused as the protocol's 400.
   */
  #read<T>(asked: {
    organizationId: string;
    connectionId?: string | null | undefined;
    method: string;
    resource: string;
    body: string;
    schema: ZodType<T>;
  }): T {
    const document = readJson(asked.body);
    const parsed = document === null ? undefined : asked.schema.safeParse(document);
    if (parsed?.success) return parsed.data;

    const refusal = requestBodyRefusal(parsed?.error);
    void this.#scim.recordRequest({
      organizationId: asked.organizationId,
      connectionId: asked.connectionId ?? null,
      method: asked.method,
      resource: asked.resource,
      status: 400,
      reason: refusal.reason,
      detail: refusal.detail,
    });

    throw scimRefusal(400, refusal.detail);
  }

  // ── SCIM 2.0 users ───────────────────────────────────────────────────────

  listUsers(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
  }): Promise<ScimListResponse<ScimUser>> {
    return this.#served({
      scope: input,
      method: "GET",
      resource: "Users",
      answered: 200,
      work: () => this.#scim.listUsers(input),
    });
  }

  createUser(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimUser> {
    const { body, ...scope } = input;
    const request = this.#read({
      ...scope,
      method: "POST",
      resource: "Users",
      body,
      schema: scimCreateUserRequestSchema,
    });

    return this.#served({
      scope: input,
      method: "POST",
      resource: "Users",
      answered: 201,
      work: () => this.#scim.createUser({ ...scope, request }),
    });
  }

  getUser(input: { organizationId: string; id: string }): Promise<ScimUser> {
    return this.#served({
      scope: input,
      method: "GET",
      resource: "Users/:id",
      answered: 200,
      work: () => this.#scim.getUser(input),
    });
  }

  replaceUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimUser> {
    const { body, ...scope } = input;
    const request = this.#read({
      ...scope,
      method: "PUT",
      resource: "Users/:id",
      body,
      schema: scimCreateUserRequestSchema,
    });

    return this.#served({
      scope: input,
      method: "PUT",
      resource: "Users/:id",
      answered: 200,
      work: () => this.#scim.replaceUser({ ...scope, request }),
    });
  }

  updateUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimUser> {
    const { body, ...scope } = input;
    const patchRequest = this.#read({
      ...scope,
      method: "PATCH",
      resource: "Users/:id",
      body,
      schema: scimPatchRequestSchema,
    });

    return this.#served({
      scope: input,
      method: "PATCH",
      resource: "Users/:id",
      answered: 200,
      work: () => this.#scim.updateUser({ ...scope, patchRequest }),
    });
  }

  deleteUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
  }): Promise<void> {
    return this.#served({
      scope: input,
      method: "DELETE",
      resource: "Users/:id",
      answered: 204,
      work: () => this.#scim.deleteUser(input),
    });
  }

  /**
   * One served request, filed as evidence once it has been answered (ADR-126).
   *
   * The record is an observation of something that already happened, so it is
   * never awaited and never fails the request: `recordRequest` swallows and
   * logs its own failure, and a refusal keeps the refusal the caller was owed.
   */
  async #served<T>({
    scope,
    method,
    resource,
    answered,
    work,
  }: {
    scope: { organizationId: string; connectionId?: string | null | undefined };
    method: string;
    resource: string;
    answered: number;
    work: () => Promise<T>;
  }): Promise<T> {
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
    return this.#served({
      scope: input,
      method: "GET",
      resource: "Groups",
      answered: 200,
      work: () => this.#scim.listGroups(input),
    });
  }

  createGroup(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimGroup> {
    const { body, ...scope } = input;
    const request = this.#read({
      ...scope,
      method: "POST",
      resource: "Groups",
      body,
      schema: scimCreateGroupRequestSchema,
    });

    return this.#served({
      scope: input,
      method: "POST",
      resource: "Groups",
      answered: 201,
      work: () => this.#scim.createGroup({ ...scope, request }),
    });
  }

  getGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimGroup> {
    return this.#served({
      scope: input,
      method: "GET",
      resource: "Groups/:id",
      answered: 200,
      work: () => this.#scim.getGroup(input),
    });
  }

  replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimGroup> {
    const { body, ...scope } = input;
    const request = this.#read({
      ...scope,
      method: "PUT",
      resource: "Groups/:id",
      body,
      schema: scimReplaceGroupRequestSchema,
    });

    return this.#served({
      scope: input,
      method: "PUT",
      resource: "Groups/:id",
      answered: 200,
      work: () => this.#scim.replaceGroup({ ...scope, request }),
    });
  }

  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimGroup> {
    const { body, ...scope } = input;
    const patchRequest = this.#read({
      ...scope,
      method: "PATCH",
      resource: "Groups/:id",
      body,
      schema: scimPatchRequestSchema,
    });

    return this.#served({
      scope: input,
      method: "PATCH",
      resource: "Groups/:id",
      answered: 200,
      work: () => this.#scim.updateGroup({ ...scope, patchRequest }),
    });
  }

  deleteGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
  }): Promise<void> {
    return this.#served({
      scope: input,
      method: "DELETE",
      resource: "Groups/:id",
      answered: 204,
      work: () => this.#scim.deleteGroup(input),
    });
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
