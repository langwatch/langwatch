import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import {
  Prisma,
  type IngestionSource,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import type {
  CreateIngestionSourceRecord,
  UpdateIngestionSourceRecord,
} from "../../ports/ingestion-source.port";
import { IngestionSourceRepository } from "../../ports/ingestion-source.port";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIngestionSource(row: IngestionSource): GovernanceIngestionSource {
  const traceProjectId =
    "traceProjectId" in row && typeof row.traceProjectId === "string" ? row.traceProjectId : null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    teamId: row.teamId,
    traceProjectId,
    sourceType: row.sourceType,
    name: row.name,
    description: row.description,
    ingestSecretHash: row.ingestSecretHash,
    parserConfig: asRecord(row.parserConfig),
    pollerCursor: row.pollerCursor,
    errorCount: row.errorCount,
    pullSchedule: row.pullSchedule,
    status: row.status,
    lastEventAt: row.lastEventAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

export class PrismaIngestionSourceRepository extends IngestionSourceRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaIngestionSourceRepository {
    return new PrismaIngestionSourceRepository(database as PrismaClient);
  }

  async list(organizationId: string): Promise<GovernanceIngestionSource[]> {
    const rows = await this.database.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }],
    });
    return rows.map(toIngestionSource);
  }

  async tryFindById(id: string): Promise<GovernanceIngestionSource | null> {
    const row = await this.database.ingestionSource.findUnique({
      where: { id },
    });
    return row ? toIngestionSource(row) : null;
  }

  async tryFindByCurrentSecretHash(hash: string): Promise<GovernanceIngestionSource | null> {
    const row = await this.database.ingestionSource.findFirst({
      where: { ingestSecretHash: hash, archivedAt: null },
    });
    return row ? toIngestionSource(row) : null;
  }

  async findByPriorSecretHash(hash: string): Promise<GovernanceIngestionSource[]> {
    const rows = await this.database.ingestionSource.findMany({
      where: {
        archivedAt: null,
        parserConfig: {
          path: ["_rotation", "priorHash"],
          equals: hash,
        },
      },
    });
    return rows.map(toIngestionSource);
  }

  countLive(organizationId: string): Promise<number> {
    return this.database.ingestionSource.count({
      where: { organizationId, archivedAt: null },
    });
  }

  async create(input: CreateIngestionSourceRecord): Promise<GovernanceIngestionSource> {
    const row = await this.database.ingestionSource.create({
      data: {
        ...input,
        parserConfig: input.parserConfig as Prisma.InputJsonValue,
      },
    });
    return toIngestionSource(row);
  }

  async update(id: string, input: UpdateIngestionSourceRecord): Promise<GovernanceIngestionSource> {
    const { parserConfig, ...rest } = input;
    const data: Prisma.IngestionSourceUncheckedUpdateInput = rest;
    if (parserConfig !== undefined) {
      data.parserConfig = parserConfig as Prisma.InputJsonValue;
    }
    const row = await this.database.ingestionSource.update({
      where: { id },
      data,
    });
    return toIngestionSource(row);
  }

  async tryUpdateIfCursorUnchanged(input: {
    id: string;
    cursor: unknown;
    update: UpdateIngestionSourceRecord;
  }): Promise<GovernanceIngestionSource | null> {
    return this.database.$transaction(async (database) => {
      const cursor =
        input.cursor === null
          ? { equals: Prisma.AnyNull }
          : { equals: input.cursor as Prisma.InputJsonValue };
      const matched = await database.ingestionSource.updateMany({
        where: { id: input.id, pollerCursor: cursor },
        data: { updatedAt: new Date() },
      });
      if (matched.count === 0) return null;

      const { parserConfig, ...rest } = input.update;
      const data: Prisma.IngestionSourceUncheckedUpdateInput = rest;
      if (parserConfig !== undefined) {
        data.parserConfig = parserConfig as Prisma.InputJsonValue;
      }
      const row = await database.ingestionSource.update({
        where: { id: input.id },
        data,
      });
      return toIngestionSource(row);
    });
  }
}
