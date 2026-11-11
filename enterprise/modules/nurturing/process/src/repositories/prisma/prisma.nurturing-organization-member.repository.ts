// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingMembership,
  NurturingMembershipChange,
} from "../../rules/nurturing-organization-member.rules.ts";
import type { NurturingOrganizationMemberRepository } from "../nurturing-organization-member.repository.ts";

type NurturingOrganizationMemberDatabase = Pick<
  PrismaClient,
  "nurturingOrganizationMember" | "$executeRaw"
>;

const dateOf = (at: number | null) => (at === null ? null : new Date(at));

/** Nurturing's own `NurturingOrganizationMember` rows, from the owners' member facts. */
export class PrismaNurturingOrganizationMemberRepository
  extends PrismaRepository.for("NurturingOrganizationMember")
  implements NurturingOrganizationMemberRepository
{
  static create({
    prisma,
  }: Readonly<{
    prisma: NurturingOrganizationMemberDatabase;
  }>): PrismaNurturingOrganizationMemberRepository {
    return new PrismaNurturingOrganizationMemberRepository(prisma);
  }

  readonly #database: NurturingOrganizationMemberDatabase;

  private constructor(prisma: NurturingOrganizationMemberDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  /** One statement; GREATEST skips a null, so only the change's own column moves, and only later. */
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
    await this.#database.$executeRaw`
      INSERT INTO "NurturingOrganizationMember" AS known
        ("organizationId", "userId", "joinedAt", "leftAt", "returnedAt")
      VALUES (${organizationId}, ${userId}, ${timeOf("joined")}::timestamp(3),
              ${timeOf("left")}::timestamp(3), ${timeOf("returned")}::timestamp(3))
      ON CONFLICT ("organizationId", "userId") DO UPDATE SET
        "joinedAt" = GREATEST(known."joinedAt", EXCLUDED."joinedAt"),
        "leftAt" = GREATEST(known."leftAt", EXCLUDED."leftAt"),
        "returnedAt" = GREATEST(known."returnedAt", EXCLUDED."returnedAt")
    `;
  }

  async forgetMember({ userId }: Readonly<{ userId: string }>): Promise<void> {
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
    return rows.map((row) => ({
      organizationId: row.organizationId,
      userId: row.userId,
      joinedAt: row.joinedAt?.getTime() ?? null,
      leftAt: row.leftAt?.getTime() ?? null,
      returnedAt: row.returnedAt?.getTime() ?? null,
    }));
  }
}
