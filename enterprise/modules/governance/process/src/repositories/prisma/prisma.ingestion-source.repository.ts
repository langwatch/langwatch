import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import {
  type Prisma,
  type IngestionSource,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { toDate } from "@langwatch/time";

import {
  IngestionSourceRepository,
  type CreateIngestionSourceRecord,
  type CursorPinnedUpdate,
  type IngestionSourceClaim,
  type UpdateIngestionSourceRecord,
} from "../ingestion-source.repository.ts";

/** The update as Prisma takes it: the seam where instants become dates. */
function updateDataOf(
  input: UpdateIngestionSourceRecord,
): Prisma.IngestionSourceUncheckedUpdateInput {
  const { parserConfig, archivedAt, lastEventAt, ...rest } = input;
  const data: Prisma.IngestionSourceUncheckedUpdateInput = rest;
  if (parserConfig !== undefined) {
    data.parserConfig = parserConfig as Prisma.InputJsonValue;
  }
  if (archivedAt !== undefined) {
    data.archivedAt = toDate(archivedAt);
  }
  if (lastEventAt !== undefined) {
    data.lastEventAt = toDate(lastEventAt);
  }

  return data;
}

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

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type IngestionSourceDatabase = Pick<PrismaClient, "ingestionSource" | "$transaction">;

export class PrismaIngestionSourceRepository extends IngestionSourceRepository {
  private constructor(private readonly database: IngestionSourceDatabase) {
    super();
  }

  static create(database: IngestionSourceDatabase): PrismaIngestionSourceRepository {
    return new PrismaIngestionSourceRepository(database);
  }

  async findAll(organizationId: string): Promise<GovernanceIngestionSource[]> {
    const rows = await this.database.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }],
    });
    return rows.map(toIngestionSource);
  }

  async findById(id: string): Promise<GovernanceIngestionSource | null> {
    const row = await this.database.ingestionSource.findUnique({
      where: { id },
    });
    return row ? toIngestionSource(row) : null;
  }

  async findByCurrentSecretHash(hash: string): Promise<GovernanceIngestionSource | null> {
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

  async findClaims(organizationId: string): Promise<IngestionSourceClaim[]> {
    const rows = await this.database.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true, status: true, providerAccountId: true, parserConfig: true },
    });
    return rows.map((row) => ({ ...row, parserConfig: asRecord(row.parserConfig) }));
  }

  findAzureBillHistory(organizationId: string): Promise<{ id: string; parserConfig: unknown }[]> {
    return this.database.ingestionSource.findMany({
      where: { organizationId, sourceType: "copilot_studio_dataverse" },
      select: { id: true, parserConfig: true },
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
    const row = await this.database.ingestionSource.update({
      where: { id },
      data: updateDataOf(input),
    });
    return toIngestionSource(row);
  }

  async updateIfCursorUnchanged(input: {
    id: string;
    cursor: unknown;
    update: UpdateIngestionSourceRecord;
  }): Promise<CursorPinnedUpdate> {
    return this.database.$transaction(async (database) => {
      // As SQL so a pin parked on the row lock re-checks the committed cursor;
      // a JSON null and SQL NULL both mean "never pulled".
      const matched =
        input.cursor === null
          ? await database.$executeRaw`
              -- @tenancy: an ingestion source is addressed by its own primary key.
              UPDATE "IngestionSource"
                 SET "updatedAt" = now()
               WHERE "id" = ${input.id}
                 AND ("pollerCursor" IS NULL OR "pollerCursor" = 'null'::jsonb)
            `
          : await database.$executeRaw`
              -- @tenancy: an ingestion source is addressed by its own primary key.
              UPDATE "IngestionSource"
                 SET "updatedAt" = now()
               WHERE "id" = ${input.id}
                 AND "pollerCursor" = ${JSON.stringify(input.cursor)}::jsonb
            `;
      if (matched === 0) return { outcome: "cursor_moved" };

      const data = updateDataOf(input.update);
      const row = await database.ingestionSource.update({
        where: { id: input.id },
        data,
      });
      return { outcome: "updated", source: toIngestionSource(row) };
    });
  }
}
