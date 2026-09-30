import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { SLACK_INTEGRATION_KSUID_RESOURCE } from "@langwatch/slack-contract";
import { fromDate } from "@langwatch/time";

import {
  SlackConnectionRepository,
  type SlackConnectionChanges,
  type SlackConnectionRecord,
  type SlackConnectionRow,
  type SlackScope,
} from "../slack-connection.repository.ts";

/** Only the model this repository touches. */
export type SlackConnectionDatabase = Pick<PrismaClient, "slackIntegration">;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const rowSelect = {
  id: true,
  name: true,
  kind: true,
  scopeType: true,
  scopeId: true,
  organizationId: true,
  botTokenEncrypted: true,
  webhookUrlEncrypted: true,
  secretFingerprint: true,
  secretHint: true,
  slackTeamId: true,
  slackTeamName: true,
  createdAt: true,
  updatedAt: true,
} as const;

type StoredRow = Omit<SlackConnectionRow, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

const toRow = (row: StoredRow): SlackConnectionRow => ({
  ...row,
  createdAt: fromDate(row.createdAt),
  updatedAt: fromDate(row.updatedAt),
});

export class PrismaSlackConnectionRepository extends SlackConnectionRepository {
  static readonly tables = prismaTables("SlackIntegration");

  private constructor(private readonly prisma: SlackConnectionDatabase) {
    super();
  }

  static create(prisma: SlackConnectionDatabase): PrismaSlackConnectionRepository {
    return new PrismaSlackConnectionRepository(prisma);
  }

  async findById({ id }: { id: string }): Promise<SlackConnectionRow[]> {
    const row = await this.prisma.slackIntegration.findUnique({ where: { id }, select: rowSelect });
    return row ? [toRow(row)] : [];
  }

  async findAllUsableByProject({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }): Promise<SlackConnectionRow[]> {
    const rows = await this.prisma.slackIntegration.findMany({
      where: {
        organizationId,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "PROJECT", scopeId: projectId },
        ],
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: rowSelect,
    });
    return rows.map(toRow);
  }

  async findAllByFingerprint({
    organizationId,
    secretFingerprint,
    scopes,
  }: {
    organizationId: string;
    secretFingerprint: string;
    scopes: SlackScope[];
  }): Promise<SlackConnectionRow[]> {
    if (scopes.length === 0) return [];
    const rows = await this.prisma.slackIntegration.findMany({
      where: {
        organizationId,
        secretFingerprint,
        OR: scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      },
      orderBy: { createdAt: "asc" },
      select: rowSelect,
    });
    return rows.map(toRow);
  }

  async create({
    record,
    actorId,
  }: {
    record: SlackConnectionRecord;
    actorId: string;
  }): Promise<SlackConnectionRow[]> {
    try {
      const row = await this.prisma.slackIntegration.create({
        data: {
          ...record,
          id: generate(SLACK_INTEGRATION_KSUID_RESOURCE).toString(),
          createdById: actorId,
          updatedById: actorId,
        },
        select: rowSelect,
      });
      return [toRow(row)];
    } catch (error) {
      if (isUniqueConstraintError(error)) return [];
      throw error;
    }
  }

  async update({
    id,
    organizationId,
    changes,
    actorId,
  }: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }): Promise<SlackConnectionRow[]> {
    try {
      const row = await this.prisma.slackIntegration.update({
        where: { id, organizationId },
        data: { ...changes, updatedById: actorId },
        select: rowSelect,
      });
      return [toRow(row)];
    } catch (error) {
      if (isUniqueConstraintError(error)) return [];
      throw error;
    }
  }

  async delete({ id, organizationId }: { id: string; organizationId: string }): Promise<void> {
    await this.prisma.slackIntegration.deleteMany({ where: { id, organizationId } });
  }
}
