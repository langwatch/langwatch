import type { IdentityHeads } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { IdentityHeadsReader } from "../../identity-heads.repository";
import { identifierRowToFact } from "./prisma.identifier.mapper";

/**
 * A user's identifier heads, read off the `Identifier` projection.
 *
 * The one read the `User.email` fork makes, and deliberately only that. The
 * full `IdentityHeadsRepository` also answers the uniqueness lookups and the
 * account mirror the guards and the ceremonies veto on, and a process that
 * composes neither has no caller for them — harvesting them here would put
 * four queries in the tree that nothing runs.
 *
 * Policy — which head answers for an address, what a state allows — lives in
 * the services and in `@langwatch/identity-contract`; this class returns
 * stored facts.
 */
export class PrismaIdentityHeadsRepository implements IdentityHeadsReader {
  static create(database: PrismaClient): PrismaIdentityHeadsRepository {
    return new PrismaIdentityHeadsRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {}

  async findHeads({ userId }: { userId: string }): Promise<IdentityHeads> {
    const rows = await this.database.identifier.findMany({ where: { userId } });
    return {
      userId,
      identifiers: Object.fromEntries(
        rows.map((row) => {
          const fact = identifierRowToFact(row);
          return [fact.identifierId, fact];
        }),
      ),
    };
  }
}
