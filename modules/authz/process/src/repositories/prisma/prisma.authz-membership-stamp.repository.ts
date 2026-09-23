import { Prisma } from "@langwatch/prisma-client/generated";

import {
  AuthzMembershipStampRepository,
  type MembershipStampRow,
} from "../authz-membership-stamp.repository.ts";

/** The one statement the lock is taken by, inside its transaction. */
export type AuthzMembershipStampTransaction = {
  $queryRaw(query: Prisma.Sql): Promise<MembershipStampRow[]>;
};

/** One interactive transaction, one statement: the lock is the point. */
export type AuthzMembershipStampDatabase = {
  $transaction<Result>(
    run: (tx: AuthzMembershipStampTransaction) => Promise<Result>,
  ): Promise<Result>;
};

/**
 * `FOR UPDATE` on the membership rows: the lock serializes this snapshot
 * with offboarding, so the generation the command carries is either the one
 * before the seat ended or the one after it, never a torn read.
 */
export class PrismaAuthzMembershipStampRepository extends AuthzMembershipStampRepository {
  static create(options: {
    database: AuthzMembershipStampDatabase;
  }): PrismaAuthzMembershipStampRepository {
    return new PrismaAuthzMembershipStampRepository(options.database);
  }

  private constructor(private readonly database: AuthzMembershipStampDatabase) {
    super();
  }

  async findLockedStamps({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<MembershipStampRow[]> {
    if (userIds.length === 0) return [];

    return this.database.$transaction(async (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT "userId", "membershipStamp"
        FROM "OrganizationUser"
        WHERE "organizationId" = ${organizationId}
          AND "userId" IN (${Prisma.join(userIds)})
          AND "disabledAt" IS NULL
        FOR UPDATE
      `),
    );
  }
}
