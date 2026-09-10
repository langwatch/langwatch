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
import {
  ENTERPRISE_FEATURE_ERRORS,
  isEnterpriseTier,
} from "@langwatch/enterprise-plan-gate";
import {
  ScimApi,
  ScimProtocolError,
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
  type ScimService,
  type ScimDeliveryAdmission,
  type ScimTokenAuditEntry,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";

import { ScimDirectoryStreamService } from "../services/scim-directory-stream.service.ts";

/**
 * The plan the organization is on, as the process resolves it. Structural: the
 * plan source is the process's, and this feature only ever asks whether it is
 * the Enterprise one.
 */
export type ScimPlanProvider = Readonly<{
  getActivePlan(input: { organizationId: string }): Promise<Readonly<{ type: string }>>;
}>;

/**
 * The deployment's management-API audit ledger, described rather than
 * imported: it is the process's, and this feature only ever appends the two
 * entries its management door has always written.
 */
export type ScimManagementAudit = (entry: {
  userId: string;
  organizationId: string;
  action: `management.${string}.${string}`;
  args?: Record<string, unknown>;
}) => void;

/** What the process composes this feature's application from. */
export type ScimInfrastructure = Readonly<{
  scim: ScimService;
  planProvider: ScimPlanProvider;
  /**
   * The shared secret Auth0 signs its log stream with, or none. A function
   * rather than a value, so a rotation without a restart works, and its
   * absence is what makes the intake answer 404 rather than 401.
   */
  webhookSecret: () => string | undefined;
  managementAudit: ScimManagementAudit;
}>;

type ScimSetup = FeatureSetup<Record<never, never>, ScimInfrastructure, undefined>;

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
  static readonly contract: typeof ScimApi = ScimApi;
  static readonly dependencies: Readonly<Record<string, never>> = {};

  readonly #scim: ScimService;
  readonly #plans: ScimPlanProvider;
  readonly #audit: ScimManagementAudit;
  readonly #webhook: ScimDirectoryStreamService;

  private constructor(members: ScimInfrastructure) {
    this.#scim = members.scim;
    this.#plans = members.planProvider;
    this.#audit = members.managementAudit;
    this.#webhook = ScimDirectoryStreamService.create({
      scim: members.scim,
      webhookSecret: members.webhookSecret,
    });
  }

  static create({ members }: ScimSetup): ScimApp {
    return new ScimApp(members);
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
    const plan = await this.#plans.getActivePlan({ organizationId: input.organizationId });

    return isEnterpriseTier(plan.type);
  }

  recordTokenAudit(entry: ScimTokenAuditEntry): void {
    this.#audit({
      userId: entry.actorId,
      organizationId: entry.organizationId,
      action: entry.action,
      args: { ...entry.args },
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

    return { organizationId: entitlement.organizationId };
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

  createUser(input: {
    organizationId: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser> {
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
