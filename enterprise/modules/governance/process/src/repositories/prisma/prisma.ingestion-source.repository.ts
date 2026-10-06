import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import {
  type Prisma,
  type IngestionSource,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import { fromDate, toDate } from "@langwatch/time";

import {
  IngestionSourceRepository,
  type CreateIngestionSourceRecord,
  type CursorPinnedUpdate,
  type IngestionSourceClaim,
  type UnpricedUsageSourceWindow,
  type UnpricedUsageWindow,
  type UpdateIngestionSourceRecord,
} from "../ingestion-source.repository.ts";
import { PrismaIngestionSourceCredentialsMapper } from "./prisma.ingestion-source-credentials.mapper.ts";

/** The update as Prisma takes it: the seam where instants become dates and credentials seal. */
function updateDataOf({
  input,
  credentials,
}: {
  input: UpdateIngestionSourceRecord;
  credentials: PrismaIngestionSourceCredentialsMapper;
}): Prisma.IngestionSourceUncheckedUpdateInput {
  const { parserConfig, archivedAt, lastEventAt, ...rest } = input;
  const data: Prisma.IngestionSourceUncheckedUpdateInput = rest;
  if (parserConfig !== undefined) {
    data.parserConfig = credentials.seal(parserConfig) as Prisma.InputJsonValue;
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

function toIngestionSource({
  row,
  credentials,
}: {
  row: IngestionSource;
  credentials: PrismaIngestionSourceCredentialsMapper;
}): GovernanceIngestionSource {
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
    parserConfig: credentials.open(asRecord(row.parserConfig)),
    pollerCursor: row.pollerCursor,
    errorCount: row.errorCount,
    lastSuccessAt: row.lastSuccessAt,
    lastReadThroughAt: row.lastReadThroughAt,
    lastRunCompleteness: row.lastRunCompleteness,
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

/**
 * Sources as Postgres holds them. `parserConfig.credentials` is sealed on every write and opened
 * on every source read; the claim and bill-history reads never touch it, so they never open it.
 */
export class PrismaIngestionSourceRepository extends IngestionSourceRepository {
  private constructor(
    private readonly database: IngestionSourceDatabase,
    private readonly credentials: PrismaIngestionSourceCredentialsMapper,
  ) {
    super();
  }

  static create({
    database,
    cipher,
  }: {
    database: IngestionSourceDatabase;
    cipher: Encryption;
  }): PrismaIngestionSourceRepository {
    return new PrismaIngestionSourceRepository(
      database,
      PrismaIngestionSourceCredentialsMapper.create({ cipher }),
    );
  }

  private toSource(row: IngestionSource): GovernanceIngestionSource {
    return toIngestionSource({ row, credentials: this.credentials });
  }

  async findAll(organizationId: string): Promise<GovernanceIngestionSource[]> {
    const rows = await this.database.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }],
    });
    return rows.map((row) => this.toSource(row));
  }

  async findById(id: string): Promise<GovernanceIngestionSource | null> {
    const row = await this.database.ingestionSource.findUnique({
      where: { id },
    });
    return row ? this.toSource(row) : null;
  }

  async findByCurrentSecretHash(hash: string): Promise<GovernanceIngestionSource | null> {
    const row = await this.database.ingestionSource.findFirst({
      where: { ingestSecretHash: hash, archivedAt: null },
    });
    return row ? this.toSource(row) : null;
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
    return rows.map((row) => this.toSource(row));
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
        parserConfig: this.credentials.seal(input.parserConfig) as Prisma.InputJsonValue,
      },
    });
    return this.toSource(row);
  }

  async update(id: string, input: UpdateIngestionSourceRecord): Promise<GovernanceIngestionSource> {
    const row = await this.database.ingestionSource.update({
      where: { id },
      data: updateDataOf({ input, credentials: this.credentials }),
    });
    return this.toSource(row);
  }

  async getUnpricedUsageWindow(id: string): Promise<UnpricedUsageWindow> {
    const row = await this.database.ingestionSource.findUniqueOrThrow({
      where: { id },
      select: { unpricedUsageSince: true, unpricedUsageThrough: true },
    });
    return {
      since: row.unpricedUsageSince ? fromDate(row.unpricedUsageSince) : null,
      through: row.unpricedUsageThrough ? fromDate(row.unpricedUsageThrough) : null,
    };
  }

  async updateUnpricedUsageWindow(id: string, window: UnpricedUsageWindow): Promise<void> {
    await this.database.ingestionSource.update({
      where: { id },
      data: {
        unpricedUsageSince: window.since ? toDate(window.since) : null,
        unpricedUsageThrough: window.through ? toDate(window.through) : null,
      },
    });
  }

  async findUnpricedUsageWindows(organizationId: string): Promise<UnpricedUsageSourceWindow[]> {
    const rows = await this.database.ingestionSource.findMany({
      where: { organizationId, archivedAt: null, unpricedUsageSince: { not: null } },
      select: { name: true, unpricedUsageSince: true, unpricedUsageThrough: true },
    });
    return rows.flatMap((row) =>
      row.unpricedUsageSince
        ? [
            {
              name: row.name,
              since: fromDate(row.unpricedUsageSince),
              through: row.unpricedUsageThrough ? fromDate(row.unpricedUsageThrough) : null,
            },
          ]
        : [],
    );
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

      const data = updateDataOf({ input: input.update, credentials: this.credentials });
      const row = await database.ingestionSource.update({
        where: { id: input.id },
        data,
      });
      return { outcome: "updated", source: this.toSource(row) };
    });
  }
}
