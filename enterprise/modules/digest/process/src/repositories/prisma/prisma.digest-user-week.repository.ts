// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";

import { type UserWeekState, userWeekStateSchema } from "../../rules/digest-week.rules.ts";
import type { DigestUserWeekRepository } from "../digest-week.repository.ts";
import { readWeekRow, weekCursorColumns } from "./prisma.digest-week.mapper.ts";

/** A person's folded coding-agent weeks, one row per (person, week) under the fold's key. */
export class PrismaDigestUserWeekRepository
  extends PrismaRepository.for("DigestUserWeek")
  implements DigestUserWeekRepository
{
  static readonly create = this.factory((prisma) => new PrismaDigestUserWeekRepository(prisma));

  get = async (
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<UserWeekState>> => {
    const row = await this.prisma.digestUserWeek.findUnique({ where: { id: key } });
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
    await this.prisma.digestUserWeek.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  };

  async listWeeks({
    isoWeeks,
    organizationId,
  }: {
    isoWeeks: readonly string[];
    organizationId?: string;
  }): Promise<UserWeekState[]> {
    const rows = await this.prisma.digestUserWeek.findMany({
      where: { isoWeek: { in: [...isoWeeks] }, ...(organizationId ? { organizationId } : {}) },
      select: { state: true },
    });
    return rows.map((row) => userWeekStateSchema.parse(row.state));
  }

  async deleteBefore({ isoWeek }: { isoWeek: string }): Promise<number> {
    const { count } = await this.prisma.digestUserWeek.deleteMany({
      where: { isoWeek: { lt: isoWeek } },
    });
    return count;
  }
}
