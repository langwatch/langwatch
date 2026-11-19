// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";

import { type ProjectWeekState, projectWeekStateSchema } from "../../rules/digest-week.rules.ts";
import type { DigestProjectWeekRepository } from "../digest-week.repository.ts";
import { readWeekRow, weekCursorColumns } from "./prisma.digest-week.mapper.ts";

/** A project's folded weeks, one row per (project, week) under the fold's aggregate key. */
export class PrismaDigestProjectWeekRepository
  extends PrismaRepository.for("DigestProjectWeek")
  implements DigestProjectWeekRepository
{
  static readonly create = this.factory((prisma) => new PrismaDigestProjectWeekRepository(prisma));

  get = async (
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<ProjectWeekState>> => {
    const row = await this.prisma.digestProjectWeek.findUnique({ where: { id: key } });
    if (!row) return { kind: "empty" };
    return readWeekRow({ row, state: projectWeekStateSchema.parse(row.state) });
  };

  store = async (
    projection: StoredProjection<ProjectWeekState>,
    context: ProjectionStoreContext,
  ): Promise<void> => {
    const id = context.key ?? context.aggregateId;
    const { state } = projection;
    const columns = {
      projectId: state.projectId,
      organizationId: state.organizationId,
      isoWeek: state.isoWeek,
      state,
      ...weekCursorColumns(projection),
    };
    await this.prisma.digestProjectWeek.upsert({
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
  }): Promise<ProjectWeekState[]> {
    const rows = await this.prisma.digestProjectWeek.findMany({
      where: { isoWeek: { in: [...isoWeeks] }, ...(organizationId ? { organizationId } : {}) },
      select: { state: true },
    });
    return rows.map((row) => projectWeekStateSchema.parse(row.state));
  }

  async deleteBefore({ isoWeek }: { isoWeek: string }): Promise<number> {
    const { count } = await this.prisma.digestProjectWeek.deleteMany({
      where: { isoWeek: { lt: isoWeek } },
    });
    return count;
  }
}
