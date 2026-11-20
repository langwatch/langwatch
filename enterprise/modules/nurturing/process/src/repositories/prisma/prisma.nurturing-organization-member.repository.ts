// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingMembership,
  NurturingMembershipChange,
} from "../../rules/nurturing-organization-member.rules.ts";
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../nurturing-organization-member.repository.ts";
import {
  type NurturingErasedUserDatabase,
  PrismaNurturingErasedUserRepository,
} from "./prisma.nurturing-erased-user.repository.ts";

type NurturingOrganizationMemberDatabase = Pick<
  PrismaClient,
  "nurturingOrganizationMember" | "$executeRaw"
> &
  NurturingErasedUserDatabase;

const dateOf = (at: number | null) => (at === null ? null : new Date(at));

type MembershipRow = Readonly<{
  organizationId: string;
  userId: string;
  joinedAt: Date | null;
  leftAt: Date | null;
  returnedAt: Date | null;
}>;

/**
 * Nurturing's own `NurturingOrganizationMember` rows, from the owners' member facts, kept free of
 * an erased account by the erasure marks.
 */
export class PrismaNurturingOrganizationMemberRepository
  extends PrismaRepository.for("NurturingOrganizationMember")
  implements NurturingOrganizationMemberRepository
{
  /**
   * `erasedUsers` defaults to the marks over the same client. It only writes marks: the writes'
   * own checks always read them on this client, through `markExists`.
   */
  static create({
    prisma,
    erasedUsers = PrismaNurturingErasedUserRepository.create({ prisma }),
  }: Readonly<{
    prisma: NurturingOrganizationMemberDatabase;
    erasedUsers?: Pick<NurturingErasedUserRepository, "markErased">;
  }>): PrismaNurturingOrganizationMemberRepository {
    return new PrismaNurturingOrganizationMemberRepository(prisma, erasedUsers);
  }

  readonly #database: NurturingOrganizationMemberDatabase;
  readonly #erasedUsers: Pick<NurturingErasedUserRepository, "markErased">;

  private constructor(
    prisma: NurturingOrganizationMemberDatabase,
    erasedUsers: Pick<NurturingErasedUserRepository, "markErased">,
  ) {
    super(prisma);
    this.#database = prisma;
    this.#erasedUsers = erasedUsers;
  }

  /**
   * One write; GREATEST skips a null, so only the change's own column moves, and only later.
   * A marked account gets no row: the re-check after the write deletes any it stored. The write's
   * own mark check only shortens how long a row its erasure raced is visible.
   */
  async recordMembershipChange({
    organizationId,
    userId,
    change,
    at,
  }: Readonly<{
    organizationId: string;
    userId: string;
    change: NurturingMembershipChange;
    at: number;
  }>): Promise<void> {
    const timeOf = (column: NurturingMembershipChange) => dateOf(change === column ? at : null);
    const marked = PrismaNurturingErasedUserRepository.markExists(userId);
    // The fact's own organization, compared with its bound id: the tenancy guard reads no tenant
    // from an INSERT ... SELECT's column list, only from a comparison.
    await this.#database.$executeRaw`
      INSERT INTO "NurturingOrganizationMember" AS known
        ("organizationId", "userId", "joinedAt", "leftAt", "returnedAt")
      SELECT fact."organizationId", fact."userId", fact."joinedAt", fact."leftAt",
             fact."returnedAt"
        FROM (VALUES (${organizationId}, ${userId}, ${timeOf("joined")}::timestamp(3),
                      ${timeOf("left")}::timestamp(3), ${timeOf("returned")}::timestamp(3)))
             AS fact ("organizationId", "userId", "joinedAt", "leftAt", "returnedAt")
       WHERE fact."organizationId" = ${organizationId} AND NOT ${marked}
      ON CONFLICT ("organizationId", "userId") DO UPDATE SET
        "joinedAt" = GREATEST(known."joinedAt", EXCLUDED."joinedAt"),
        "leftAt" = GREATEST(known."leftAt", EXCLUDED."leftAt"),
        "returnedAt" = GREATEST(known."returnedAt", EXCLUDED."returnedAt")
    `;
    // The write can read no mark for an account whose erasure has not committed it yet, then land
    // after the erasure's DELETE passed. This separate statement closes that race: if it starts
    // after the mark commits, it sees the mark; if before, the write committed before the mark,
    // so the erasure's DELETE, which starts after its mark, sees the row.
    await this.#database.$executeRaw`
      DELETE FROM "NurturingOrganizationMember"
       WHERE "organizationId" = ${organizationId} AND "userId" = ${userId} AND ${marked}`;
  }

  /**
   * Marks the account erased first, so a member fact landing from then on writes no row for it,
   * then deletes its rows. The other copies an erasure clears mark it too: whichever lands first,
   * the others change nothing.
   */
  async forgetMember({ userId }: Readonly<{ userId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId });
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erased account is a member of no organization: its rows go by user, in every one.
      SKIP_TENANT_CHECK: true,
    })}
      DELETE FROM "NurturingOrganizationMember" WHERE "userId" = ${userId}`;
  }

  async findMembershipsOfMembers({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingMembership[]> {
    const members = await this.#database.nurturingOrganizationMember.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    if (members.length === 0) return [];
    const rows = await this.#database.nurturingOrganizationMember.findMany({
      where: { userId: { in: members.map(({ userId }) => userId) } },
    });
    return rows.map((row) => this.membershipOf(row));
  }

  /** A read by the named users, which the tenancy guard admits for a non-empty list. */
  async findMembershipsOfUsers({
    userIds,
  }: Readonly<{ userIds: readonly string[] }>): Promise<NurturingMembership[]> {
    // Bounds each IN list, so a large organization never sends one huge query.
    const usersPerRead = 1000;
    const memberships: NurturingMembership[] = [];
    for (let start = 0; start < userIds.length; start += usersPerRead) {
      const rows = await this.#database.nurturingOrganizationMember.findMany({
        where: { userId: { in: userIds.slice(start, start + usersPerRead) } },
      });
      memberships.push(...rows.map((row) => this.membershipOf(row)));
    }
    return memberships;
  }

  private membershipOf(row: MembershipRow): NurturingMembership {
    return {
      organizationId: row.organizationId,
      userId: row.userId,
      joinedAt: row.joinedAt?.getTime() ?? null,
      leftAt: row.leftAt?.getTime() ?? null,
      returnedAt: row.returnedAt?.getTime() ?? null,
    };
  }
}
