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

import { type ProjectWeekState, projectWeekStateSchema } from "../../rules/digest-week.rules.ts";
import type { DigestProjectWeekRepository } from "../digest-week.repository.ts";
import { readWeekRow, weekCursorColumns } from "./prisma.digest-week.mapper.ts";

/** The week rows, plus the raw SQL the retention sweep across organizations needs. */
type PrismaDigestProjectWeekDatabase = PrismaModelClient<"DigestProjectWeek"> &
  Pick<PrismaClient, "$executeRaw">;

/** A project's folded weeks, one row per (project, week) under the fold's aggregate key. */
export class PrismaDigestProjectWeekRepository
  extends PrismaRepository.for("DigestProjectWeek")
  implements DigestProjectWeekRepository
{
  // Its own create, not `this.factory`: the factory's model-scoped client carries no `$executeRaw`.
  static create({
    prisma,
  }: {
    prisma: PrismaDigestProjectWeekDatabase;
  }): PrismaDigestProjectWeekRepository {
    return new PrismaDigestProjectWeekRepository(prisma);
  }

  private constructor(private readonly database: PrismaDigestProjectWeekDatabase) {
    super(database);
  }

  get = async (
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<ProjectWeekState>> => {
    const row = await this.database.digestProjectWeek.findUnique({ where: { id: key } });
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
    await this.database.digestProjectWeek.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  };

  async findWeeks({
    isoWeeks,
    organizationId,
  }: {
    isoWeeks: readonly string[];
    organizationId: string;
  }): Promise<ProjectWeekState[]> {
    const rows = await this.database.digestProjectWeek.findMany({
      where: { organizationId, isoWeek: { in: [...isoWeeks] } },
      select: { state: true },
    });
    return rows.map((row) => projectWeekStateSchema.parse(row.state));
  }

  async deleteBefore({ isoWeek }: { isoWeek: string }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Retention sweeps every organization's weeks older than any send still reads.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "DigestProjectWeek" WHERE "isoWeek" < ${isoWeek}
    `;
  }
}
