import { toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import { AuthzUserStandingRepository } from "../authz-user-standing.repository.ts";

/** The raw statements the standing table is written in: each upsert is one statement. */
type PrismaAuthzUserStandingDatabase = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

const userIdRowsSchema = z.array(z.object({ userId: z.string() }));

export class PrismaAuthzUserStandingRepository extends AuthzUserStandingRepository {
  static create(options: {
    database: PrismaAuthzUserStandingDatabase;
  }): PrismaAuthzUserStandingRepository {
    return new PrismaAuthzUserStandingRepository(options.database);
  }

  private constructor(private readonly database: PrismaAuthzUserStandingDatabase) {
    super();
  }

  async recordDeactivated({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    await this.recordActivation({ userId, at, deactivated: true });
  }

  async recordReactivated({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    await this.recordActivation({ userId, at, deactivated: false });
  }

  async recordErased({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    const when = toDate(at);
    await this.database.$executeRaw`
      -- @tenancy: platform-wide; a user's standing belongs to no organization
      INSERT INTO "AuthzUserStanding" ("userId", "erasedAt", "standingChangedAt")
      VALUES (${userId}, ${when}, ${when})
      ON CONFLICT ("userId") DO UPDATE
      SET "erasedAt" = COALESCE("AuthzUserStanding"."erasedAt", EXCLUDED."erasedAt")
    `;
  }

  async findInactiveUserIds({ userIds }: { userIds: readonly string[] }): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.database.$queryRaw`
      -- @tenancy: platform-wide; a user's standing belongs to no organization
      SELECT "userId" FROM "AuthzUserStanding"
      WHERE "userId" = ANY(${[...new Set(userIds)]})
        AND ("deactivatedAt" IS NOT NULL OR "erasedAt" IS NOT NULL)
    `;

    return userIdRowsSchema.parse(rows).map((row) => row.userId);
  }

  /**
   * Applies only a fact newer than the last one applied, so a redelivery or a late one is a no-op.
   * Facts are ordered by each pod's clock (no log position reaches a peer subscriber), so a tie
   * goes to the deactivation: when the order is unknowable, access ends rather than continues.
   */
  private async recordActivation({
    userId,
    at,
    deactivated,
  }: {
    userId: string;
    at: Instant;
    deactivated: boolean;
  }): Promise<void> {
    const when = toDate(at);
    await this.database.$executeRaw`
      -- @tenancy: platform-wide; a user's standing belongs to no organization
      INSERT INTO "AuthzUserStanding" ("userId", "deactivatedAt", "standingChangedAt")
      VALUES (${userId}, ${deactivated ? when : null}, ${when})
      ON CONFLICT ("userId") DO UPDATE
      SET "deactivatedAt" = EXCLUDED."deactivatedAt",
          "standingChangedAt" = EXCLUDED."standingChangedAt"
      WHERE "AuthzUserStanding"."standingChangedAt" < EXCLUDED."standingChangedAt"
         OR (EXCLUDED."deactivatedAt" IS NOT NULL
             AND "AuthzUserStanding"."standingChangedAt" = EXCLUDED."standingChangedAt")
    `;
  }
}
