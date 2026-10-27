import {
  datasetColumnsSchema,
  datasetVersionAuthorSchema,
  datasetVersionTriggerSchema,
  type DatasetVersion,
  type DatasetVersionRunLink,
} from "@langwatch/dataset-contract";
import { generate } from "@langwatch/ksuid";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";

import {
  DatasetVersionNumberTakenError,
  type DatasetVersionRepository,
  type DatasetWithVersionHistory,
  type NewDatasetVersion,
} from "../dataset-version.repository.ts";

type DatasetVersionDatabase = Pick<
  PrismaClient,
  "datasetVersion" | "datasetVersionRun" | "$queryRaw"
>;

type VersionRow = Prisma.DatasetVersionGetPayload<Record<string, never>>;

/** The version tables, declared: the retention scan is SQL across projects. */
export class PrismaDatasetVersionRepository implements DatasetVersionRepository {
  static readonly tables = prismaTables("DatasetVersion", "DatasetVersionRun");

  static create({ prisma }: { prisma: DatasetVersionDatabase }): PrismaDatasetVersionRepository {
    return new PrismaDatasetVersionRepository(prisma);
  }

  private constructor(private readonly database: DatasetVersionDatabase) {}

  async findLatest(input: {
    projectId: string;
    datasetId: string;
  }): Promise<DatasetVersion | null> {
    const row = await this.database.datasetVersion.findFirst({
      where: { projectId: input.projectId, datasetId: input.datasetId },
      orderBy: { version: "desc" },
    });
    return row ? (await this.#withRuns(input.projectId, [row]))[0]! : null;
  }

  async findByNumber(input: {
    projectId: string;
    datasetId: string;
    version: number;
  }): Promise<DatasetVersion | null> {
    const row = await this.database.datasetVersion.findFirst({
      where: { projectId: input.projectId, datasetId: input.datasetId, version: input.version },
    });
    return row ? (await this.#withRuns(input.projectId, [row]))[0]! : null;
  }

  async findAll(input: { projectId: string; datasetId: string }): Promise<DatasetVersion[]> {
    const rows = await this.database.datasetVersion.findMany({
      where: { projectId: input.projectId, datasetId: input.datasetId },
      orderBy: { version: "desc" },
    });
    return this.#withRuns(input.projectId, rows);
  }

  async create(input: NewDatasetVersion): Promise<DatasetVersion> {
    const { pinned, sizeBytes, ...fields } = input;
    try {
      const row = await this.database.datasetVersion.create({
        data: {
          ...fields,
          sizeBytes: BigInt(sizeBytes),
          pinnedAt: pinned ? new Date() : null,
        },
      });
      return toVersion(row, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DatasetVersionNumberTakenError();
      }
      throw error;
    }
  }

  async rename(input: { projectId: string; id: string; name: string }): Promise<DatasetVersion> {
    await this.database.datasetVersion.updateMany({
      where: { projectId: input.projectId, id: input.id },
      data: { name: input.name },
    });
    return this.#getById(input);
  }

  async pin(input: { projectId: string; id: string }): Promise<DatasetVersion> {
    await this.database.datasetVersion.updateMany({
      where: { projectId: input.projectId, id: input.id, pinnedAt: null },
      data: { pinnedAt: new Date() },
    });
    return this.#getById(input);
  }

  async linkRun(input: {
    projectId: string;
    runId: string;
    experimentId: string | null;
    versions: readonly { datasetId: string; versionId: string }[];
  }): Promise<void> {
    if (input.versions.length === 0) return;
    await this.database.datasetVersionRun.createMany({
      data: input.versions.map((link) => ({
        id: generate("datasetversionrun").toString(),
        projectId: input.projectId,
        runId: input.runId,
        experimentId: input.experimentId,
        datasetId: link.datasetId,
        versionId: link.versionId,
      })),
      skipDuplicates: true,
    });
  }

  async findRunLinks(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<DatasetVersionRunLink[]> {
    if (input.runIds.length === 0) return [];
    const links = await this.database.datasetVersionRun.findMany({
      where: { projectId: input.projectId, runId: { in: [...input.runIds] } },
    });
    if (links.length === 0) return [];
    const versions = await this.database.datasetVersion.findMany({
      where: { projectId: input.projectId, id: { in: links.map((link) => link.versionId) } },
      select: { id: true, version: true },
    });
    const numberOf = new Map(versions.map((row) => [row.id, row.version]));
    return links.flatMap((link) => {
      const version = numberOf.get(link.versionId);
      return version === undefined
        ? []
        : [{ runId: link.runId, datasetId: link.datasetId, versionId: link.versionId, version }];
    });
  }

  async findDatasetsWithHistory(input: {
    afterDatasetId: string | null;
    olderThanMs: number;
    limit: number;
  }): Promise<DatasetWithVersionHistory[]> {
    const olderThan = new Date(input.olderThanMs);
    return this.database.$queryRaw<DatasetWithVersionHistory[]>`${skipTenantCheck({
      // Retention sweeps every project's version history, one dataset at a time.
      SKIP_TENANT_CHECK: true,
    })}
      SELECT "projectId", "datasetId"
        FROM "DatasetVersion"
       WHERE "createdAt" < ${olderThan}
         AND (${input.afterDatasetId}::text IS NULL OR "datasetId" > ${input.afterDatasetId})
       GROUP BY "projectId", "datasetId"
      HAVING count(*) > 1
       ORDER BY "datasetId" ASC
       LIMIT ${input.limit}`;
  }

  async hasAny(input: { projectId: string; datasetId: string }): Promise<boolean> {
    const row = await this.database.datasetVersion.findFirst({
      where: { projectId: input.projectId, datasetId: input.datasetId },
      select: { id: true },
    });
    return row !== null;
  }

  async deleteMany(input: { projectId: string; ids: readonly string[] }): Promise<number> {
    if (input.ids.length === 0) return 0;
    const deleted = await this.database.datasetVersion.deleteMany({
      where: { projectId: input.projectId, id: { in: [...input.ids] } },
    });
    return deleted.count;
  }

  async #getById(input: { projectId: string; id: string }): Promise<DatasetVersion> {
    const row = await this.database.datasetVersion.findFirstOrThrow({
      where: { projectId: input.projectId, id: input.id },
    });
    return (await this.#withRuns(input.projectId, [row]))[0]!;
  }

  async #withRuns(projectId: string, rows: VersionRow[]): Promise<DatasetVersion[]> {
    if (rows.length === 0) return [];
    const counts = await this.database.datasetVersionRun.groupBy({
      by: ["versionId"],
      where: { projectId, versionId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((row) => [row.versionId, row._count._all]));
    return rows.map((row) => toVersion(row, countOf.get(row.id) ?? 0));
  }
}

function toVersion(row: VersionRow, runCount: number): DatasetVersion {
  return {
    id: row.id,
    projectId: row.projectId,
    datasetId: row.datasetId,
    version: row.version,
    name: row.name,
    trigger: datasetVersionTriggerSchema.parse(row.trigger),
    contentHash: row.contentHash,
    columnTypes: datasetColumnsSchema.parse(row.columnTypes),
    rowCount: row.rowCount,
    sizeBytes: Number(row.sizeBytes),
    chunkCount: row.chunkCount,
    restoredFromVersion: row.restoredFromVersion,
    authorId: row.authorId,
    authorKind:
      row.authorKind === null ? null : datasetVersionAuthorSchema.shape.kind.parse(row.authorKind),
    pinned: row.pinnedAt !== null,
    runCount,
    createdAt: row.createdAt,
  };
}
