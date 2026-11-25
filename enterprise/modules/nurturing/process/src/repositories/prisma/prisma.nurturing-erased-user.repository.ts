// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import { erasedUserHashOf } from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";

export type NurturingErasedUserDatabase = Pick<PrismaClient, "nurturingErasedUser" | "$executeRaw">;

/** Bounds each IN list, as the member copy's reads do, so a large list never sends one query. */
const USERS_PER_READ = 1000;

/** Nurturing's own `NurturingErasedUser` marks, the one place they are written and read. */
export class PrismaNurturingErasedUserRepository
  extends PrismaRepository.for("NurturingErasedUser")
  implements NurturingErasedUserRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingErasedUserDatabase }>): PrismaNurturingErasedUserRepository {
    return new PrismaNurturingErasedUserRepository(prisma);
  }

  /**
   * Whether an id is marked erased, in SQL, for a write that checks the mark in its own statement.
   * Such a check only shortens how long a row naming the person is visible; the write's re-check
   * after it is what keeps them off.
   */
  static markExists(userId: string | null): Prisma.Sql {
    return userId === null
      ? Prisma.sql`false`
      : Prisma.sql`EXISTS (SELECT 1 FROM "NurturingErasedUser"
                            WHERE "userIdHash" = ${erasedUserHashOf(userId)})`;
  }

  readonly #database: NurturingErasedUserDatabase;

  private constructor(prisma: NurturingErasedUserDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async markErased({ userId }: Readonly<{ userId: string }>): Promise<void> {
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erasure spans every organization: the mark is the account's alone.
      SKIP_TENANT_CHECK: true,
    })}
      INSERT INTO "NurturingErasedUser" ("userIdHash")
      VALUES (${erasedUserHashOf(userId)})
      ON CONFLICT ("userIdHash") DO NOTHING`;
  }

  /** Reads by the accounts' hashes; the marks hold no id, so each maps back by its hash. */
  async findErased({ userIds }: Readonly<{ userIds: readonly string[] }>): Promise<string[]> {
    const userIdOf = new Map(userIds.map((userId) => [erasedUserHashOf(userId), userId]));
    const hashes = [...userIdOf.keys()];
    const erased: string[] = [];
    for (let start = 0; start < hashes.length; start += USERS_PER_READ) {
      const marks = await this.#database.nurturingErasedUser.findMany({
        where: { userIdHash: { in: hashes.slice(start, start + USERS_PER_READ) } },
        select: { userIdHash: true },
      });
      erased.push(...marks.flatMap(({ userIdHash }) => userIdOf.get(userIdHash) ?? []));
    }
    return erased;
  }
}
