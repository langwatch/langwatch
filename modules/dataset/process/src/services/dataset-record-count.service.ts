/**
 * How many entries each listed dataset holds, read apart from the list so the
 * list never waits on it. Only datasets kept in the entries table are counted
 * there; every other layout answers from its stored count.
 */
import {
  datasetDisplayRecordCount,
  storesRowsInRecordsTable,
  type DatasetRecordCount,
} from "@langwatch/dataset-contract";

import type { DatasetRecordRepository } from "../repositories/dataset-record.repository.ts";
import type { DatasetRepository } from "../repositories/dataset.repository.ts";

export class DatasetRecordCountService {
  static create({
    datasets,
    records,
  }: {
    datasets: DatasetRepository;
    records: DatasetRecordRepository;
  }): DatasetRecordCountService {
    return new DatasetRecordCountService(datasets, records);
  }

  private constructor(
    private readonly datasets: DatasetRepository,
    private readonly records: DatasetRecordRepository,
  ) {}

  /** Callers bound `datasetIds`: the tRPC read by its schema, a list by its own page size. */
  async countRecords({
    projectId,
    datasetIds,
  }: {
    projectId: string;
    datasetIds: readonly string[];
  }): Promise<DatasetRecordCount[]> {
    const columns = await this.datasets.findRecordCountColumns({ projectId, datasetIds });
    const inRecordsTable = columns.filter(storesRowsInRecordsTable).map((dataset) => dataset.id);
    const grouped = await this.records.countByDataset({ projectId, datasetIds: inRecordsTable });
    const countedById = new Map(grouped.map((row) => [row.datasetId, row.recordCount]));

    return columns.map((dataset) => ({
      datasetId: dataset.id,
      recordCount: storesRowsInRecordsTable(dataset)
        ? (countedById.get(dataset.id) ?? 0)
        : datasetDisplayRecordCount(dataset),
    }));
  }
}
