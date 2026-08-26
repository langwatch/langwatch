// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import crypto from "node:crypto";
import type { UserProfile, UserService } from "@langwatch/user-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
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
  ScimTokenNotFoundError,
  type ScimTokenEntitlement,
  type ScimTokenSummary,
} from "@langwatch/enterprise-scim-contract";
import type { ScimRepositoryPort } from "../ports/scim-repository.port";
import { ScimDirectoryService } from "./scim-directory.service";
import { ScimGrantsService } from "./scim-grants.service";
import { ScimProvisioningService } from "./scim-provisioning.service";

/**
 * Maps between SCIM 2.0 User resources and LangWatch User/OrganizationUser models.
 * All operations are scoped to an organization for multi-tenancy.
 */
export class ScimService extends ScimServiceContract {
  private readonly repository: ScimRepositoryPort;
  private readonly userOperations: ScimProvisioningService;
  private readonly groups: ScimDirectoryService;
  private readonly entitlements: EntitlementService;

  private constructor({
    prisma,
    writer,
    users,
    governance,
    entitlements,
  }: {
    prisma: ScimRepositoryPort;
    writer: AuthzGrantsService;
    users: UserService;
    governance: GovernanceService;
    entitlements: EntitlementService;
  }) {
    super();
    this.repository = prisma;
    const grants = ScimGrantsService.create({ repository: prisma, grants: writer });
    this.userOperations = ScimProvisioningService.create({
      prisma,
      writer,
      grants,
      users,
      governance,
    });
    this.entitlements = entitlements;
    this.groups = ScimDirectoryService.create({ prisma, grants });
  }

  static create(options: {
    prisma: ScimRepositoryPort;
    writer: AuthzGrantsService;
    users: UserService;
    governance: GovernanceService;
    entitlements: EntitlementService;
  }): ScimService {
    return new ScimService(options);
  }

  tryFindOrganizationBySsoDomain(input: {
    domain: string;
  }): Promise<{ id: string } | null> {
    return this.repository.tryFindOrganizationBySsoDomain(input);
  }

  async generateToken(input: {
    organizationId: string;
    description?: string;
  }): Promise<{ token: string; tokenId: string }> {
    const token = crypto.randomBytes(32).toString("hex");
    const stored = await this.repository.createToken({
      organizationId: input.organizationId,
      hashedToken: this.hashToken(token),
      description: input.description ?? null,
    });
    return { token, tokenId: stored.id };
  }

  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    return this.repository.listTokens(input.organizationId);
  }

  async revokeToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }> {
    if (!(await this.repository.revokeToken(input))) {
      throw new ScimTokenNotFoundError(input.tokenId);
    }
    return { success: true };
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
    return { status: "ok", organizationId: stored.organizationId };
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

  createGroup(input: {
    organizationId: string;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup> {
    return this.groups.createGroup(input);
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
  }): Promise<ScimUser> {
    return this.userOperations.createUser(input);
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
  }): Promise<ScimUser> {
    return this.userOperations.replaceUser(input);
  }

  async updateUser(input: {
    id: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimUser> {
    return this.userOperations.updateUser(input);
  }

  async deleteUser(input: { id: string; organizationId: string }): Promise<void> {
    return this.userOperations.deleteUser(input);
  }

  toScimUser(user: UserProfile): ScimUser {
    return this.userOperations.toScimUser(user);
  }
}
