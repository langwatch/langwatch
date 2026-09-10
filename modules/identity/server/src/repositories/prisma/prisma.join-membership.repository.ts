import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  type AuthzGrantsService,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { JoinMembershipPort } from "../../rules/join-requests-contract.rules.ts";

/**
 * The KSUID resource an organization-scoped grant is born under. Spelled as a
 * literal, the way every other module spells its own: the prefix is a
 * PERSISTED format, and a second description of it writes bindings the
 * revocation queries never find.
 */
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/**
 * How a join approval becomes a membership: the `OrganizationUser` row plus
 * the organization-scoped grant, the SAME two-step shape invitation
 * acceptance and SSO auto-join already use (ADR-092).
 */
export class PrismaJoinMembershipRepository implements JoinMembershipPort {
  static create(
    prisma: PrismaClient,
    writer: AuthzGrantsService,
  ): PrismaJoinMembershipRepository {
    return new PrismaJoinMembershipRepository(prisma, writer);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: AuthzGrantsService,
  ) {}

  async isMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const held = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { userId: true },
    });

    return held !== null;
  }

  async attachDefaultMembership({
    userId,
    organizationId,
    approvedByUserId,
  }: {
    userId: string;
    organizationId: string;
    approvedByUserId: string | null;
  }): Promise<void> {
    await this.prisma.organizationUser.createMany({
      data: [{ userId, organizationId, role: OrganizationUserRole.MEMBER }],
      skipDuplicates: true,
    });

    await this.writer.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: generate(ROLE_BINDING_KSUID_RESOURCE).toString(),
          principal: { userId },
          role: TeamUserRole.MEMBER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
      // The admin who approved, or the policy that did. Both reach the
      // customer's audit page - `join-request` is deliberately NOT in
      // `NON_AUDITABLE_SOURCES`, so a surprising automatic join looks exactly
      // like a surprising approval somebody clicked.
      actor: approvedByUserId
        ? { type: "user", id: approvedByUserId }
        : { type: "system", id: SYSTEM_ACTORS.joinRequests },
      source: "join-request",
      onDuplicate: "skip",
    });
  }
}
