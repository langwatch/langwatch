// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";

import {
  type ProjectWeekState,
  projectWeekStateSchema,
  type UserWeekState,
  userWeekStateSchema,
} from "../../rules/digest-week.rules.ts";
import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../digest-week.repository.ts";

type Row = Readonly<{
  state: unknown;
  occurredAt: Date;
  lastEventId: string;
  acceptedAt: Date;
  projectionVersion: string;
  createdAt: Date;
  updatedAt: Date;
}>;

function cursorColumns<State>(projection: StoredProjection<State>) {
  return {
    occurredAt: new Date(projection.occurredAt),
    lastEventId: projection.cursor.eventId,
    acceptedAt: new Date(projection.cursor.acceptedAt),
    projectionVersion: projection.version,
    createdAt: new Date(projection.createdAt),
    updatedAt: new Date(projection.updatedAt),
  };
}

function readRow<State>({ row, state }: { row: Row; state: State }): StoredProjectionRead<State> {
  return {
    kind: "folded",
    projection: {
      state,
      cursor: { acceptedAt: row.acceptedAt.getTime(), eventId: row.lastEventId },
      occurredAt: row.occurredAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion,
    },
  };
}

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
    return readRow({ row, state: projectWeekStateSchema.parse(row.state) });
  };

  store = async (
    projection: StoredProjection<ProjectWeekState>,
    context: ProjectionStoreContext,
  ): Promise<void> => {
    const id = context.aggregateId;
    const { state } = projection;
    const columns = {
      projectId: state.projectId,
      organizationId: state.organizationId,
      isoWeek: state.isoWeek,
      state,
      ...cursorColumns(projection),
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

/** A person's folded coding-agent weeks, one row per (user, week). */
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
    return readRow({ row, state: userWeekStateSchema.parse(row.state) });
  };

  store = async (
    projection: StoredProjection<UserWeekState>,
    context: ProjectionStoreContext,
  ): Promise<void> => {
    const id = context.aggregateId;
    const { state } = projection;
    const columns = {
      userId: state.userId,
      organizationId: state.organizationId,
      isoWeek: state.isoWeek,
      state,
      ...cursorColumns(projection),
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
