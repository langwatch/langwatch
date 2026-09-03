import {
  datasetColumnsSchema,
  type DatasetColumns,
  type DatasetColumnType,
  type DatasetRecordEntry,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
import type { Field, NodeDataset } from "@langwatch/workflow-contract";
import { z } from "zod";

export type StudioInMemoryDataset = {
  datasetId?: string;
  name?: string;
  datasetRecords: DatasetRecordEntry[];
  columnTypes: DatasetColumns;
};

const storedStudioDatasetRecordSchema = z
  .object({
    id: z.string().min(1),
    entry: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const storedStudioDatasetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    columnTypes: datasetColumnsSchema.default([]),
    datasetRecords: z.array(storedStudioDatasetRecordSchema),
  })
  .passthrough();

export type StoredStudioDatasetRecord = z.input<typeof storedStudioDatasetRecordSchema>;
export type StoredStudioDataset = z.input<typeof storedStudioDatasetSchema>;

export function transpostRowsFirstToColumnsFirstWithoutId(
  data: Array<Record<string, unknown>>,
): Record<string, unknown[]> {
  const columns: Record<string, unknown[]> = {};

  for (const row of data) {
    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || key === "selected") continue;
      const column = columns[key] ?? [];
      column.push(value);
      columns[key] = column;
    }
  }

  return columns;
}

const fieldToColumnTypeMap: Record<Field["type"], DatasetColumnType> = {
  str: "string",
  image: "image",
  float: "number",
  int: "number",
  bool: "boolean",
  list: "list",
  "list[str]": "list",
  "list[float]": "list",
  "list[int]": "list",
  "list[bool]": "list",
  dict: "json",
  json_schema: "json",
  signature: "string",
  llm: "string",
  prompting_technique: "string",
  dataset: "string",
  code: "string",
  chat_messages: "json",
};

const columnTypeToFieldTypeMap: Record<DatasetColumnType, Field["type"]> = {
  string: "str",
  boolean: "bool",
  number: "float",
  date: "str",
  json: "dict",
  list: "list",
  spans: "dict",
  rag_contexts: "dict",
  chat_messages: "chat_messages",
  annotations: "dict",
  evaluations: "dict",
  image: "image",
};

export const datasetColumnTypeToFieldType = (
  columnType: DatasetColumnType,
): Field["type"] => columnTypeToFieldTypeMap[columnType];

export function fieldsToDatasetColumns(fields: Field[]): DatasetColumns {
  return fields.map((field) => ({
    name: field.identifier,
    type: fieldToColumnTypeMap[field.type],
  }));
}

export function datasetColumnsToFields(columns: DatasetColumns): Field[] {
  return columns.map((column) => ({
    identifier: column.name,
    type: columnTypeToFieldTypeMap[column.type],
  }));
}

export function inMemoryDatasetToNodeDataset(
  dataset: StudioInMemoryDataset,
): NodeDataset {
  return dataset.datasetId
    ? {
        id: dataset.datasetId,
        name: dataset.name,
      }
    : {
        name: dataset.name,
        inline: {
          records: transpostRowsFirstToColumnsFirstWithoutId(dataset.datasetRecords),
          columnTypes: dataset.columnTypes,
        },
      };
}

export const simpleRecordListToNodeDataset = (
  records: Array<Record<string, unknown>>,
): NodeDataset => {
  const columnsFirst = transpostRowsFirstToColumnsFirstWithoutId(records);
  return {
    inline: {
      records: columnsFirst,
      columnTypes: Object.keys(columnsFirst).map((key) => ({
        name: key,
        type: "string",
      })),
    },
  };
};

export const datasetDatabaseRecordsToInMemoryDataset = (
  dataset: unknown,
): StudioInMemoryDataset => {
  const storedDataset = storedStudioDatasetSchema.parse(dataset);
  const datasetRecords = storedDataset.datasetRecords.map((record) => {
    const row: DatasetRecordEntry = { id: record.id };

    for (const column of storedDataset.columnTypes) {
      const value = record.entry?.[column.name];
      row[column.name] = typeof value === "object" ? JSON.stringify(value) : value;
    }

    return row;
  });

  return {
    name: storedDataset.name,
    datasetRecords,
    columnTypes: storedDataset.columnTypes,
  };
};

export const trainTestSplit = <Value>(
  list: Value[],
  { trainSize, testSize }: { trainSize: number; testSize: number },
): { train: Value[]; test: Value[] } => {
  const total = list.length;
  const isPercentage = trainSize < 1 || testSize < 1;
  const trainCount = isPercentage ? Math.floor(total * trainSize) : trainSize;
  const testCount = isPercentage ? Math.ceil(total * testSize) : testSize;

  return {
    train: list.slice(0, trainCount),
    test: list.slice(trainCount, trainCount + testCount),
  };
};

export const tryToMapPreviousColumnsToNewColumns = (
  datasetRecords: DatasetRecordInput[],
  previousColumns: DatasetColumns,
  newColumns: DatasetColumns,
): DatasetRecordInput[] => {
  const columnNameMap = new Map<string, string>();

  for (const previousColumn of previousColumns) {
    const matchingNewColumn = newColumns.find(
      (newColumn) => newColumn.name === previousColumn.name,
    );
    if (matchingNewColumn) {
      columnNameMap.set(previousColumn.name, matchingNewColumn.name);
    }
  }

  const unmappedPreviousColumns = previousColumns.filter(
    (column) => !columnNameMap.has(column.name),
  );
  const unmappedNewColumns = newColumns.filter(
    (column) => !Array.from(columnNameMap.values()).includes(column.name),
  );

  for (
    let index = 0;
    index < Math.min(unmappedPreviousColumns.length, unmappedNewColumns.length);
    index++
  ) {
    const previousColumn = unmappedPreviousColumns[index];
    const newColumn = unmappedNewColumns[index];
    if (previousColumn && newColumn) {
      columnNameMap.set(previousColumn.name, newColumn.name);
    }
  }

  return datasetRecords.map((record) => {
    const convertedRecord: DatasetRecordInput = {};
    if (record.id !== void 0) {
      convertedRecord.id = record.id;
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === "id") continue;

      const newColumnName = columnNameMap.get(key);
      if (newColumnName) {
        convertedRecord[newColumnName] = value;
      }
    }

    return convertedRecord;
  });
};
