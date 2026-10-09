// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type ScimCreateUserRequest,
  type ScimDirectoryOwnership,
  type ScimCreateGroupRequest,
  type ScimGroup,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimReplaceGroupRequest,
  type ScimRequestLogEntry,
  type ScimRequestLogQuery,
  type ScimRequestRecord,
  type ScimUser,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
} from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";

import type { ScimSeatRepository } from "../repositories/scim-seat.repository.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";
import type { ScimCostCenterFacts } from "./scim-cost-center.service.ts";
import type { ScimOrganizationAdministration } from "./scim-deprovision.service.ts";
import {
  ScimDirectoryIdentityService,
  type ScimHeldConnections,
} from "./scim-directory-identity.service.ts";
import { ScimDirectoryService } from "./scim-directory.service.ts";
import { type ScimGrantAuthority, ScimGrantsService } from "./scim-grants.service.ts";
import { ScimProvisioningService, type ScimUserProvisioning } from "./scim-provisioning.service.ts";
import { ScimRequestLogService } from "./scim-request-log.service.ts";
import type { ScimSyncLifecycle, ScimUserPushOperation } from "./scim-sync-lifecycle.service.ts";
import { ScimTokenService } from "./scim-token.service.ts";

/**
 * Maps between SCIM 2.0 User resources and LangWatch User/OrganizationUser models.
 * All operations are scoped to an organization for multi-tenancy.
 */
/**
 * SCIM takes the dependencies it passes down, not the whole services they came from:
 * `ScimCostCenterFacts` is the one recorder the leaf cost-center service writes through.
 */
export class ScimService {
  private readonly repository: ScimRepository;
  private readonly userOperations: ScimProvisioningService;
  private readonly groups: ScimDirectoryService;
  private readonly identities: ScimDirectoryIdentityService;
  private readonly lifecycle: ScimSyncLifecycle;
  private readonly requests: ScimRequestLogService;
  private readonly tokens: ScimTokenService;

  private constructor({
    prisma,
    writer,
    users,
    costCenterFacts,
    organization,
    seats,
    members,
    entitlements,
    lifecycle,
    provenOffboarding,
    tokenPepper,
    previousTokenPepper,
    connections,
  }: {
    prisma: ScimRepository;
    writer: ScimGrantAuthority;
    users: ScimUserProvisioning;
    costCenterFacts: ScimCostCenterFacts;
    organization: ScimOrganizationAdministration;
    seats: ScimSeatRepository;
    members: Pick<OrganizationApi, "deleteMember">;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
    tokenPepper: string | undefined;
    previousTokenPepper?: string | undefined;
    connections: ScimHeldConnections;
  }) {
    this.repository = prisma;
    this.requests = ScimRequestLogService.create(prisma);
    this.identities = ScimDirectoryIdentityService.create({ repository: prisma, connections });
    this.lifecycle = lifecycle;
    const grants = ScimGrantsService.create({ grants: writer });
    this.userOperations = ScimProvisioningService.create({
      prisma,
      writer,
      grants,
      users,
      costCenterFacts,
      organization,
      members,
      lifecycle,
      provenOffboarding,
      authority: this.identities,
      seats,
      plans: entitlements,
      connections,
    });
    this.tokens = ScimTokenService.create({
      repository: prisma,
      entitlements,
      lifecycle,
      tokenPepper,
      previousTokenPepper,
    });
    this.groups = ScimDirectoryService.create({
      prisma,
      grants,
      identities: this.identities,
      provenOffboarding,
    });
  }

  static create(options: {
    prisma: ScimRepository;
    writer: ScimGrantAuthority;
    users: ScimUserProvisioning;
    costCenterFacts: ScimCostCenterFacts;
    organization: ScimOrganizationAdministration;
    seats: ScimSeatRepository;
    members: Pick<OrganizationApi, "deleteMember">;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    lifecycle: ScimSyncLifecycle;
    provenOffboarding: boolean;
    tokenPepper: string | undefined;
    previousTokenPepper?: string | undefined;
    connections: ScimHeldConnections;
  }): ScimService {
    return new ScimService(options);
  }

  findOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null> {
    return this.repository.findOrganizationBySsoDomain(input);
  }

  // ── What the directory asked, and what we answered (ADR-126) ─────────────

  recordRequest(request: ScimRequestRecord): Promise<void> {
    return this.requests.record(request);
  }

  findRequestLog(query: ScimRequestLogQuery): Promise<ScimRequestLogEntry[]> {
    return this.requests.findForConnection(query);
  }

  sweepExpiredRequests(input: { now: Instant }): Promise<number> {
    return this.requests.sweepExpired(input);
  }

  findDirectoryOwnership(input: { connectionIds: string[] }): Promise<ScimDirectoryOwnership[]> {
    return this.identities.findOwnership(input);
  }

  generateToken(
    input: Parameters<ScimTokenService["generateToken"]>[0],
  ): Promise<{ token: string; tokenId: string; connectionId: string }> {
    return this.tokens.generateToken(input);
  }

  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    return this.tokens.listTokens(input);
  }

  revokeToken(input: { organizationId: string; tokenId: string }): Promise<{ success: true }> {
    return this.tokens.revokeToken(input);
  }

  revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }> {
    return this.tokens.revokeTokensForConnection(input);
  }

  verifyToken(input: { token: string }): Promise<ScimTokenEntitlement> {
    return this.tokens.verifyToken(input);
  }

  recordTokenUse(input: { tokenId: string }): Promise<void> {
    return this.tokens.recordTokenUse(input);
  }

  /**
   * The directory acts as itself, not as whoever happens to hold the SCIM
   * token. When identity connections exist this becomes the connection id
   * (ADR-092's identity-platform seam); the event shape already takes it.
   */
  listGroups(input: {
    organizationId: string;
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
    excludeMembers?: boolean;
  }): Promise<ScimListResponse<ScimGroup>> {
    return this.groups.listGroups(input);
  }

  getGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
    excludeMembers?: boolean;
  }): Promise<ScimGroup> {
    return this.groups.getGroup(input);
  }

  async createGroup(input: {
    organizationId: string;
    connectionId?: string | null;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup> {
    const group = await this.groups.createGroup(input);
    if (input.connectionId) {
      await this.lifecycle.groupMapped({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        groupId: group.id,
        externalId: input.request.externalId ?? null,
      });
    }

    return group;
  }

  replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup> {
    return this.groups.replaceGroup(input);
  }

  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup> {
    return this.groups.updateGroup(input);
  }

  deleteGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
  }): Promise<void> {
    return this.groups.deleteGroup(input);
  }

  async createUser(input: {
    request: ScimCreateUserRequest;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimUser> {
    const externalId = input.request.externalId;
    const mappedUserId =
      input.connectionId && externalId
        ? await this.identities.findUserId({
            connectionId: input.connectionId,
            externalId,
          })
        : null;
    const user = mappedUserId
      ? await this.userOperations.replaceUser({
          id: mappedUserId,
          organizationId: input.organizationId,
          request: input.request,
        })
      : await this.userOperations.createUser(input);
    if (input.connectionId) {
      await this.identities.remember({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalId,
        userId: user.id,
      });
    }

    await this.recordUserPush({
      ...input,
      userId: user.id,
      externalId,
      op: "create",
    });

    return { ...user, ...(externalId ? { externalId } : {}) };
  }

  async getUser(input: { id: string; organizationId: string }): Promise<ScimUser> {
    return this.userOperations.getUser(input);
  }

  async listUsers(input: {
    organizationId: string;
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser>> {
    return this.userOperations.listUsers(input);
  }

  async replaceUser(input: {
    id: string;
    organizationId: string;
    request: ScimCreateUserRequest;
    connectionId?: string | null;
  }): Promise<ScimUser> {
    await this.identities.assertWritable({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });
    const user = await this.userOperations.replaceUser(input);
    const externalId = input.request.externalId;
    if (input.connectionId) {
      await this.identities.remember({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalId,
        userId: input.id,
      });
    }

    await this.recordUserPush({
      ...input,
      userId: input.id,
      externalId,
      op: input.request.active === false ? "deactivate" : "update",
    });

    return { ...user, ...(externalId ? { externalId } : {}) };
  }

  async updateUser(input: {
    id: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
    connectionId?: string | null;
  }): Promise<ScimUser> {
    await this.identities.assertWritable({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });
    const user = await this.userOperations.updateUser(input);
    // Deactivation keeps ownership, so the same directory can bring them back.
    if (input.connectionId) {
      await this.identities.remember({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalId: null,
        userId: input.id,
      });
    }
    await this.recordUserPush({
      ...input,
      userId: input.id,
      externalId: null,
      op: this.patchDeactivates(input.patchRequest) ? "deactivate" : "update",
    });

    return user;
  }

  async deleteUser(input: {
    id: string;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<void> {
    await this.identities.assertWritable({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });
    await this.userOperations.deleteUser(input);
    await this.identities.forgetUser({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });

    await this.recordUserPush({
      ...input,
      userId: input.id,
      externalId: null,
      op: "deactivate",
    });
  }

  toScimUser(user: UserProfile): ScimUser {
    return this.userOperations.toScimUser(user);
  }

  private async recordUserPush(input: {
    organizationId: string;
    connectionId?: string | null;
    userId: string;
    externalId: string | null | undefined;
    op: ScimUserPushOperation;
  }): Promise<void> {
    if (!input.connectionId) {
      return;
    }

    await this.lifecycle.userPushed({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      userId: input.userId,
      externalId: input.externalId ?? input.userId,
      op: input.op,
    });
  }

  private patchDeactivates(request: ScimPatchRequest): boolean {
    return request.Operations.some((operation) => {
      if (operation.op !== "replace") {
        return false;
      }

      if (operation.path === "active") {
        return operation.value === false || operation.value === "false";
      }

      if (typeof operation.value !== "object" || operation.value === null) {
        return false;
      }

      if (!("active" in operation.value)) {
        return false;
      }

      const active = operation.value.active;

      return active === false || active === "false";
    });
  }
}
