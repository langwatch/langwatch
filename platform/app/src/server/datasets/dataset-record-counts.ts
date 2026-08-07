import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Attaches the `_count.datasetRecords` shape that dataset lists render, without
 * Prisma's relation-count `include`.
 *
 * Prisma compiles `include: { _count: { select: { datasetRecords: true } } }`
 * into a subquery with no tenancy predicate at all:
 *
 *   LEFT JOIN (SELECT "datasetId", COUNT(*) FROM "DatasetRecord"
 *              WHERE 1=1 GROUP BY "datasetId") ...
 *
 * so every dataset list aggregates the whole `DatasetRecord` table across every
 * tenant, and the cost of one customer's list grows with all the others' data.
 *
 * Counting here instead keeps the read inside the project and inside the
 * datasets that actually store rows in that table: `s3_jsonl` and legacy
 * `useS3` datasets keep their content in object storage, so their row count is
 * already a column on `Dataset` and their `DatasetRecord` count is a
 * guaranteed zero that nobody reads (see `datasetDisplayRecordCount`). A
 * project fully on object storage issues no count query at all.
 */

type CountableDataset = {
  id: string;
  contentLayout?: string | null;
  useS3?: boolean | null;
};

/**
 * Whether a dataset's entries still live in the `DatasetRecord` table. Mirrors
 * the fallback branch of `datasetDisplayRecordCount` — the two must agree, or
 * a dataset gets counted and then has its count discarded, or vice versa.
 */
const storesRowsInRecordsTable = (dataset: CountableDataset): boolean =>
  dataset.contentLayout !== "s3_jsonl" && !dataset.useS3;

export const attachDatasetRecordCounts = async <T extends CountableDataset>({
  prisma,
  projectId,
  datasets,
}: {
  prisma: PrismaClient | Prisma.TransactionClient;
  projectId: string;
  datasets: T[];
}): Promise<Array<T & { _count: { datasetRecords: number } }>> => {
  const datasetIds = datasets.filter(storesRowsInRecordsTable).map((d) => d.id);

  const grouped =
    datasetIds.length > 0
      ? await prisma.datasetRecord.groupBy({
          by: ["datasetId"],
          where: { projectId, datasetId: { in: datasetIds } },
          _count: { _all: true },
        })
      : [];

  const countByDatasetId = new Map(
    grouped.map((row) => [row.datasetId, row._count._all]),
  );

  return datasets.map((dataset) => ({
    ...dataset,
    _count: { datasetRecords: countByDatasetId.get(dataset.id) ?? 0 },
  }));
};
