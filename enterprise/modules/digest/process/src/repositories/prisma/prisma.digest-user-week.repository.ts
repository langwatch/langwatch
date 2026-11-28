// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import {
  type PrismaModelClient,
  PrismaRepository,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { type UserWeekState, userWeekStateSchema } from "../../rules/digest-week.rules.ts";
import type { DigestUserWeekRepository } from "../digest-week.repository.ts";
import { readWeekRow, weekCursorColumns } from "./prisma.digest-week.mapper.ts";

/** The week rows, plus the raw SQL the retention sweep across organizations needs. */
type PrismaDigestUserWeekDatabase = PrismaModelClient<"DigestUserWeek"> &
  Pick<PrismaClient, "$executeRaw">;

/** A person's folded coding-agent weeks, one row per (organization, person, week). */
export class PrismaDigestUserWeekRepository
  extends PrismaRepository.for("DigestUserWeek")
  implements DigestUserWeekRepository
{
  // Its own create, not `this.factory`: the factory's model-scoped client carries no `$executeRaw`.
  static create({
    prisma,
  }: {
    prisma: PrismaDigestUserWeekDatabase;
  }): PrismaDigestUserWeekRepository {
    return new PrismaDigestUserWeekRepository(prisma);
  }

  private constructor(private readonly database: PrismaDigestUserWeekDatabase) {
    super(database);
  }

  get = async (
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<UserWeekState>> => {
    const row = await this.database.digestUserWeek.findUnique({ where: { id: key } });
    if (!row) return { kind: "empty" };
    return readWeekRow({ row, state: userWeekStateSchema.parse(row.state) });
  };

  store = async (
    projection: StoredProjection<UserWeekState>,
    context: ProjectionStoreContext,
  ): Promise<void> => {
    const id = context.key ?? context.aggregateId;
    const { state } = projection;
    const columns = {
      userId: state.userId,
      organizationId: state.organizationId,
      isoWeek: state.isoWeek,
      state,
      ...weekCursorColumns(projection),
    };
    await this.database.digestUserWeek.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  };

  async findWeeks({
    isoWeeks,
    organizationId,
    userId,
  }: {
    isoWeeks: readonly string[];
    organizationId: string;
    userId: string;
  }): Promise<UserWeekState[]> {
    const rows = await this.database.digestUserWeek.findMany({
      where: { organizationId, userId, isoWeek: { in: [...isoWeeks] } },
      select: { state: true },
    });
    return rows.map((row) => userWeekStateSchema.parse(row.state));
  }

  async forgetUser({ userId }: { userId: string }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // A person's weeks sit under each organization they were active in: they go by user.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "DigestUserWeek" WHERE "userId" = ${userId}
    `;
  }

  async deleteBefore({ isoWeek }: { isoWeek: string }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Retention sweeps every organization's weeks older than any send still reads.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "DigestUserWeek" WHERE "isoWeek" < ${isoWeek}
    `;
  }
}
