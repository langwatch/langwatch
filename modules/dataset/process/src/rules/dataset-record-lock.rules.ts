import type {
  DatasetRecordRepository,
  LockedDatasetRecords,
} from "../repositories/dataset-record.repository.ts";

/** A lock-bound view: the record calls of `records` plus the dataset row's columns. */
export function lockedView({
  records,
  columns,
}: {
  records: Omit<DatasetRecordRepository, "withDatasetLock">;
  columns: Pick<LockedDatasetRecords, "columnTypes" | "setColumnTypes">;
}): LockedDatasetRecords {
  return {
    count: (input) => records.count(input),
    countByDataset: (input) => records.countByDataset(input),
    findPage: (input) => records.findPage(input),
    findByIds: (input) => records.findByIds(input),
    listAll: (input) => records.listAll(input),
    createMany: (input) => records.createMany(input),
    update: (input) => records.update(input),
    deleteMany: (input) => records.deleteMany(input),
    replaceAll: (input) => records.replaceAll(input),
    columnTypes: () => columns.columnTypes(),
    setColumnTypes: (columnTypes) => columns.setColumnTypes(columnTypes),
  };
}
