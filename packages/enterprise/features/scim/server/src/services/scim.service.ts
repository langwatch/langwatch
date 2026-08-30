// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import crypto from "node:crypto";
import type { UserProfile, UserService } from "@langwatch/user-contract";
import type { EntitlementService } from "@langwatch/entitlement-contract";
import {
  type ScimCreateUserRequest,
  type ScimCreateGroupRequest,
  type ScimGroup,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimReplaceGroupRequest,
  type ScimUser,
} from "@langwatch/enterprise-scim-contract";
import {
  ScimService as ScimServiceContract,
  ScimConnectionNotFoundError,
  ScimConnectionRequiredError,
  ScimTokenNotFoundError,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
} from "@langwatch/enterprise-scim-contract";
import type { ScimRepositoryPort } from "../ports/scim-repository.port";
import type {
  ScimSyncLifecyclePort,
  ScimUserPushOperation,
} from "../ports/scim-sync-lifecycle.port";
import { ScimDirectoryService } from "./scim-directory.service";
import { ScimDirectoryIdentityService } from "./scim-directory-identity.service";
import { ScimGrantsService } from "./scim-grants.service";
import { ScimProvisioningService } from "./scim-provisioning.service";
import type { ScimDepartmentAssignment } from "./scim-cost-center.service";
import type { ScimSessionRevocation } from "./scim-user-profile.service";

/**
 * Maps between SCIM 2.0 User resources and LangWatch User/OrganizationUser models.
 * All operations are scoped to an organization for multi-tenancy.
 */
/**
 * SCIM takes the two dependencies it passes down, not the two whole services
 * they came from: `ScimSessionRevocation` is `auth.revokeAllBrowserSessions`
 * and `ScimDepartmentAssignment` is Governance's two department calls, each
 * declared beside the leaf service that makes the call.
 *
 * Asking for a whole `AuthService` and a whole `GovernanceService` to use three
 * methods is what forced every test here to build a one-method object and cast
 * it at a service it shares nothing else with. The cast is the signal: a
 * dependency that can only be satisfied by lying about it is asking for more
 * than it needs.
 */
export class ScimService extends ScimServiceContract {
  private readonly repository: ScimRepositoryPort;
  private readonly userOperations: ScimProvisioningService;
  private readonly groups: ScimDirectoryService;
  private readonly entitlements: EntitlementService;
  private readonly identities: ScimDirectoryIdentityService;
  private readonly lifecycle: ScimSyncLifecyclePort;

  private constructor({
    prisma,
    writer,
    users,
    auth,
    governance,
    entitlements,
    lifecycle,
    provenOffboarding,
  }: {
    prisma: ScimRepositoryPort;
    writer: AuthzGrantsService;
    users: UserService;
    auth: ScimSessionRevocation;
    governance: ScimDepartmentAssignment;
    entitlements: EntitlementService;
    lifecycle: ScimSyncLifecyclePort;
    provenOffboarding: boolean;
  }) {
    super();
    this.repository = prisma;
    this.identities = ScimDirectoryIdentityService.create(prisma);
    this.lifecycle = lifecycle;
    const grants = ScimGrantsService.create({ repository: prisma, grants: writer });
    this.userOperations = ScimProvisioningService.create({
      prisma,
      writer,
      grants,
      users,
      auth,
      governance,
      lifecycle,
      provenOffboarding,
    });
    this.entitlements = entitlements;
    this.groups = ScimDirectoryService.create({ prisma, grants });
  }

  static create(options: {
    prisma: ScimRepositoryPort;
    writer: AuthzGrantsService;
    users: UserService;
    auth: ScimSessionRevocation;
    governance: ScimDepartmentAssignment;
    entitlements: EntitlementService;
    lifecycle: ScimSyncLifecyclePort;
    provenOffboarding: boolean;
  }): ScimService {
    return new ScimService(options);
  }

  tryFindOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null> {
    return this.repository.tryFindOrganizationBySsoDomain(input);
  }

  async generateToken(input: {
    organizationId: string;
    connectionId?: string | null;
    description?: string;
  }): Promise<{ token: string; tokenId: string; connectionId: string }> {
    if (!input.connectionId) {
      throw new ScimConnectionRequiredError();
    }
    const exists = await this.repository.scimConnectionExists({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });
    if (!exists) {
      throw new ScimConnectionNotFoundError(input.connectionId);
    }

    const token = crypto.randomBytes(32).toString("hex");
    const stored = await this.repository.createToken({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      hashedToken: this.hashToken(token),
      description: input.description ?? null,
    });
    await this.lifecycle.tokenIssued({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      tokenId: stored.id,
    });
    return { token, tokenId: stored.id, connectionId: input.connectionId };
  }

  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    return this.repository.listTokens(input.organizationId);
  }

  async revokeToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }> {
    const token = await this.repository.tryFindToken(input);
    if (!(await this.repository.revokeToken(input))) {
      throw new ScimTokenNotFoundError(input.tokenId);
    }
    if (token?.connectionId) {
      await this.lifecycle.revoked({
        organizationId: input.organizationId,
        connectionId: token.connectionId,
        tokenId: input.tokenId,
        cause: "revoke",
      });
    }
    return { success: true };
  }

  async revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }> {
    const revoked = await this.repository.revokeTokensForConnection(input);
    await this.lifecycle.revoked({
      ...input,
      tokenId: null,
      cause: "teardown",
    });
    return { revoked };
  }

  async verifyToken(input: { token: string }): Promise<ScimTokenEntitlement> {
    const stored = await this.repository.tryFindTokenByHash(this.hashToken(input.token));
    if (!stored) {
      return { status: "invalid_token" };
    }
    const plan = await this.entitlements.getActivePlan({
      organizationId: stored.organizationId,
    });
    if (plan.type !== "ENTERPRISE") {
      return { status: "plan_not_entitled", organizationId: stored.organizationId };
    }
    await this.repository.recordTokenUse({ tokenId: stored.id, usedAt: new Date() });
    return {
      status: "ok",
      organizationId: stored.organizationId,
      connectionId: stored.connectionId,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * The directory acts as itself, not as whoever happens to hold the SCIM
   * token. When identity connections exist this becomes the connection id
   * (ADR-092's identity-platform seam); the event shape already takes it.
   */
  listGroups(input: {
    organizationId: string;
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
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup> {
    return this.groups.replaceGroup(input);
  }

  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup> {
    return this.groups.updateGroup(input);
  }

  deleteGroup(input: { organizationId: string; externalScimId: string }): Promise<void> {
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
        ? await this.identities.tryGetUserId({
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
    if (input.connectionId && externalId) {
      await this.identities.remember({
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
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });
    const user = await this.userOperations.replaceUser(input);
    const externalId = input.request.externalId;
    if (input.connectionId && externalId) {
      await this.identities.remember({
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
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });
    const user = await this.userOperations.updateUser(input);
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
      connectionId: input.connectionId ?? null,
      userId: input.id,
    });
    await this.userOperations.deleteUser(input);
    if (input.connectionId) {
      await this.identities.forgetUser({
        connectionId: input.connectionId,
        userId: input.id,
      });
    }
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
    if (!input.connectionId) return;

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
      if (operation.op !== "replace") return false;
      if (operation.path === "active") {
        return operation.value === false || operation.value === "false";
      }
      if (typeof operation.value !== "object" || operation.value === null) {
        return false;
      }
      if (!("active" in operation.value)) return false;

      const active = operation.value.active;
      return active === false || active === "false";
    });
  }
}
