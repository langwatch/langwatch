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
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import {
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
  type ScimGroup,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimReplaceGroupRequest,
  type ScimServerConfig,
  type ScimService,
  type ScimDeliveryAdmission,
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
import type { FeatureSetup } from "@langwatch/kernel";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { UserApi } from "@langwatch/user-contract";

import { PrismaScimRepository } from "../repositories/prisma/prisma.scim.repository.ts";
import { PostgresScimService } from "../services/postgres-scim.service.ts";
import { ScimDirectoryStreamService } from "../services/scim-directory-stream.service.ts";
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
    auth: AuthApi,
    governance: GovernanceRestApi,
    entitlements: EntitlementApi,
    auditLog: AuditLogApi,
  };
  static readonly config = scimConfig;
  static readonly secrets = scimSecrets;
  static readonly reads = reads("prisma");

  readonly #scim: ScimService;
  readonly #entitlements: Pick<EntitlementApi, "getActivePlan">;
  readonly #auditLog: Pick<AuditLogApi, "record">;
  readonly #webhook: ScimDirectoryStreamService;

  private constructor(options: {
    scim: ScimService;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    auditLog: Pick<AuditLogApi, "record">;
    webhookSecret: () => string | undefined;
  }) {
    this.#scim = options.scim;
    this.#entitlements = options.entitlements;
    this.#auditLog = options.auditLog;
    this.#webhook = ScimDirectoryStreamService.create({
      scim: options.scim,
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
      auth: dependencies.auth,
      governance: dependencies.governance,
      entitlements: dependencies.entitlements,
      lifecycle: members.lifecycle,
      provenOffboarding: config.provenOffboarding,
    });

    return ScimApp.createWithService({
      scim,
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
  }): Promise<ScimDirectoryScope> {
    const token = findBearer(input.authorization);

    if (!token) throw scimRefusal(401, "Bearer token is required");

    const entitlement = await this.#scim.verifyToken({ token });

    if (entitlement.status === "invalid_token") {
      throw scimRefusal(401, "Bearer token is not valid");
    }

    if (entitlement.status === "plan_not_entitled") {
      throw scimRefusal(403, ENTERPRISE_FEATURE_ERRORS.SCIM);
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

  // ── SCIM 2.0 users ───────────────────────────────────────────────────────

  listUsers(input: {
    organizationId: string;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
  }): Promise<ScimListResponse<ScimUser>> {
    return this.#scim.listUsers(input);
  }

  createUser(input: { organizationId: string; request: ScimCreateUserRequest }): Promise<ScimUser> {
    return this.#scim.createUser(input);
  }

  getUser(input: { organizationId: string; id: string }): Promise<ScimUser> {
    return this.#scim.getUser(input);
  }

  replaceUser(input: {
    organizationId: string;
    id: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser> {
    return this.#scim.replaceUser(input);
  }

  updateUser(input: {
    organizationId: string;
    id: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimUser> {
    return this.#scim.updateUser(input);
  }

  deleteUser(input: { organizationId: string; id: string }): Promise<void> {
    return this.#scim.deleteUser(input);
  }

  // ── SCIM 2.0 groups ──────────────────────────────────────────────────────

  listGroups(input: {
    organizationId: string;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimListResponse<ScimGroup>> {
    return this.#scim.listGroups(input);
  }

  createGroup(input: {
    organizationId: string;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup> {
    return this.#scim.createGroup(input);
  }

  getGroup(input: {
    organizationId: string;
    externalScimId: string;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimGroup> {
    return this.#scim.getGroup(input);
  }

  replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup> {
    return this.#scim.replaceGroup(input);
  }

  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup> {
    return this.#scim.updateGroup(input);
  }

  deleteGroup(input: { organizationId: string; externalScimId: string }): Promise<void> {
    return this.#scim.deleteGroup(input);
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
