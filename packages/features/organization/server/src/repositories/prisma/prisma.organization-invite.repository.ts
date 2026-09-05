import type {
  Organization,
  OrganizationInvite,
  OrganizationUser,
  OrganizationUserRole,
  Prisma,
  PrismaClient,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";
import { tryFindPersonalTeamInScopes } from "./prisma.personal-team-scope.repository";
import {
  OrganizationInviteRepository,
  type InviteWithOrganization,
  type InviteWithRequester,
  type WriteInviteInput,
} from "../organization-invite.repository";

/** A root client, or the transaction-scoped client `$transaction` hands back. */
type InviteClient = PrismaClient | Prisma.TransactionClient;

function inviteJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

/** Private Prisma owner for an organization's invitations and what settles them. */
export class PrismaOrganizationInviteRepository extends OrganizationInviteRepository {
  static create(options: { database: PrismaClient }): PrismaOrganizationInviteRepository {
    return new PrismaOrganizationInviteRepository(options.database, options.database);
  }

  private constructor(
    private readonly prisma: InviteClient,
    /** Absent on a transaction-scoped instance — only the root can open one. */
    private readonly root: PrismaClient | null,
  ) {
    super();
  }

  async withTransaction<T>(
    write: (transaction: OrganizationInviteRepository) => Promise<T>,
    options?: { timeoutMs: number; maxWaitMs: number },
  ): Promise<T> {
    if (!this.root) {
      throw new Error("This orchestration requires a root Prisma client, not a transaction client");
    }

    return await this.root.$transaction(
      (client) => write(new PrismaOrganizationInviteRepository(client, null)),
      options ? { timeout: options.timeoutMs, maxWait: options.maxWaitMs } : undefined,
    );
  }

  tryFindOpenInviteForEmail({
    email,
    organizationId,
  }: {
    email: string;
    organizationId: string;
  }): Promise<OrganizationInvite | null> {
    return this.prisma.organizationInvite.findFirst({
      where: {
        email: { equals: email.trim(), mode: "insensitive" },
        organizationId,
        status: { in: ["PENDING", "PAYMENT_PENDING"] },
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
    });
  }

  async tryFindMemberEmail({
    organizationId,
    emails,
  }: {
    organizationId: string;
    emails: string[];
  }): Promise<string | null> {
    const existing = await this.prisma.organizationUser.findFirst({
      where: { organizationId, user: { email: { in: emails, mode: "insensitive" } } },
      select: { user: { select: { email: true } } },
    });

    return existing ? (existing.user.email ?? "") : null;
  }

  async findTeamIdsInOrganization({
    teamIds,
    organizationId,
  }: {
    teamIds: string[];
    organizationId: string;
  }): Promise<string[]> {
    const teams = await this.prisma.team.findMany({
      where: { id: { in: teamIds }, organizationId },
      select: { id: true },
    });

    return teams.map((team) => team.id);
  }

  findCustomRolePermissions({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Array<{ id: string; permissions: unknown }>> {
    return this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
  }

  tryFindOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Organization | null> {
    return this.prisma.organization.findFirst({ where: { id: organizationId } });
  }

  tryFindOrganizationWithMembers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<(Organization & { members: OrganizationUser[] }) | null> {
    return this.prisma.organization.findFirst({
      where: { id: organizationId },
      include: { members: true },
    });
  }

  tryFindPersonalTeamInScopes({
    scopes,
  }: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<{ name: string } | null> {
    return tryFindPersonalTeamInScopes({ client: this.prisma, scopes });
  }

  createPendingInvite(input: WriteInviteInput): Promise<OrganizationInvite> {
    return this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode: input.inviteCode,
        expiration: input.expiration,
        organizationId: input.organizationId,
        teamIds: input.teamIds,
        teamAssignments: inviteJson(input.teamAssignments),
        role: input.role,
        status: "PENDING",
      },
    });
  }

  createPaymentPendingInvite(
    input: WriteInviteInput & { subscriptionId: string },
  ): Promise<OrganizationInvite> {
    return this.prisma.organizationInvite.create({
      data: {
        email: input.email,
        inviteCode: input.inviteCode,
        expiration: input.expiration,
        organizationId: input.organizationId,
        teamIds: input.teamIds,
        teamAssignments: inviteJson(input.teamAssignments),
        role: input.role,
        status: "PAYMENT_PENDING",
        subscriptionId: input.subscriptionId,
      },
    });
  }

  findListableInvites({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<InviteWithRequester[]> {
    return this.prisma.organizationInvite.findMany({
      where: { organizationId, status: { in: ["PENDING", "REVOKED"] } },
      include: { requestedByUser: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeOpenInvite({
    inviteId,
    organizationId,
  }: {
    inviteId: string;
    organizationId: string;
  }): Promise<number> {
    const { count } = await this.prisma.organizationInvite.updateMany({
      where: { id: inviteId, organizationId, status: { in: ["PENDING", "PAYMENT_PENDING"] } },
      data: { status: "REVOKED" },
    });

    return count;
  }

  tryFindInviteWithOrganization({
    inviteId,
    organizationId,
  }: {
    inviteId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization | null> {
    return this.prisma.organizationInvite.findFirst({
      where: { id: inviteId, organizationId },
      include: { organization: true },
    });
  }

  async rotateInviteCode({
    inviteId,
    organizationId,
    expectedInviteCode,
    inviteCode,
    expiration,
  }: {
    inviteId: string;
    organizationId: string;
    expectedInviteCode: string;
    inviteCode: string;
    expiration: Date;
  }): Promise<number> {
    const { count } = await this.prisma.organizationInvite.updateMany({
      where: {
        id: inviteId,
        organizationId,
        status: "PENDING",
        inviteCode: expectedInviteCode,
      },
      data: { inviteCode, expiration },
    });

    return count;
  }

  tryFindInviteByCodeWithOrganization({
    inviteCode,
  }: {
    inviteCode: string;
  }): Promise<InviteWithOrganization | null> {
    return this.prisma.organizationInvite.findUnique({
      where: { inviteCode },
      include: { organization: true },
    });
  }

  async findAdminEmails({ organizationId }: { organizationId: string }): Promise<string[]> {
    const admins = await this.prisma.organizationUser.findMany({
      where: { organizationId, role: "ADMIN" },
      select: { user: { select: { email: true } } },
    });

    return admins
      .map((admin) => admin.user.email)
      .filter((email): email is string => Boolean(email));
  }

  async tryFindProjectSlugForTeams({ teamIds }: { teamIds: string[] }): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: { teamId: { in: teamIds }, archivedAt: null },
      select: { slug: true },
    });

    return project?.slug ?? null;
  }

  async tryFindProjectSlugInOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: { team: { organizationId, archivedAt: null }, archivedAt: null },
      select: { slug: true },
    });

    return project?.slug ?? null;
  }

  tryFindPendingInviteForEmail({
    organizationId,
    email,
  }: {
    organizationId: string;
    email: string;
  }): Promise<OrganizationInvite | null> {
    return this.prisma.organizationInvite.findFirst({
      where: {
        organizationId,
        email: { equals: email, mode: "insensitive" },
        status: "PENDING",
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
    });
  }

  async claimInviteForAcceptance({
    inviteId,
    organizationId,
    inviteCode,
    acceptedByUserId,
    acceptedViaIdentifierId,
  }: {
    inviteId: string;
    organizationId: string;
    inviteCode: string;
    acceptedByUserId: string;
    acceptedViaIdentifierId: string | null;
  }): Promise<number> {
    const { count } = await this.prisma.organizationInvite.updateMany({
      where: {
        id: inviteId,
        organizationId,
        inviteCode,
        status: "PENDING",
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
      data: { status: "ACCEPTED", acceptedByUserId, acceptedViaIdentifierId },
    });

    return count;
  }

  async addMembership({
    userId,
    organizationId,
    role,
  }: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
  }): Promise<void> {
    await this.prisma.organizationUser.createMany({
      data: [{ userId, organizationId, role }],
      skipDuplicates: true,
    });
  }

  tryFindInviteStatus({ inviteId }: { inviteId: string }): Promise<{ status: string } | null> {
    return this.prisma.organizationInvite.findUnique({
      where: { id: inviteId },
      select: { status: true },
    });
  }

  async hasMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { userId: true },
    });

    return membership != null;
  }

  findPaymentPendingInvites({
    subscriptionId,
    organizationId,
  }: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization[]> {
    return this.prisma.organizationInvite.findMany({
      where: { subscriptionId, organizationId, status: "PAYMENT_PENDING" },
      include: { organization: true },
    });
  }

  approvePaymentPendingInvite({
    inviteId,
    organizationId,
    expiration,
  }: {
    inviteId: string;
    organizationId: string;
    expiration: Date;
  }): Promise<OrganizationInvite> {
    return this.prisma.organizationInvite.update({
      where: { id: inviteId, organizationId },
      data: { status: "PENDING", expiration },
    });
  }
}
