import { nanoid } from "nanoid";
import type {
  DatasetColumns,
  DatasetColumnType,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import type { Entry, Field, NodeDataset } from "../types/dsl";
import type { InMemoryDataset } from "../../components/datasets/DatasetTable";
import type { Dataset, DatasetRecord } from "@prisma/client";

export function transposeColumnsFirstToRowsFirstWithId(
  data: Record<string, string[]>
): DatasetRecordEntry[] {
  return Object.entries(data).reduce((acc, [column, values]) => {
    values.forEach((value, index) => {
      acc[index] = acc[index] ?? { id: nanoid() };
      // @ts-ignore
      acc[index][column] = value;
    });
    return acc;
  }, [] as DatasetRecordEntry[]);
}

export function transpostRowsFirstToColumnsFirstWithoutId(
  data: DatasetRecordEntry[]
): Record<string, string[]> {
  return data.reduce(
    (acc, row) => {
      Object.entries(row).forEach(([key, value]) => {
        if (key === "id" || key === "selected") return;
        acc[key] = acc[key] ?? [];
        // @ts-ignore
        acc[key].push(value);
      });
      return acc;
    },
    {} as Record<string, string[]>
  );
}

const fieldToColumnTypeMap: Record<Field["type"], DatasetColumnType> = {
  str: "string",
  float: "number",
  int: "number",
  bool: "boolean",
  "list[str]": "json",
  "list[float]": "json",
  "list[int]": "json",
  "list[bool]": "json",
  dict: "json",
  signature: "string",
  llm: "string",
  prompting_technique: "string",
  dataset: "string",
};

const columnTypeToFieldTypeMap: Record<DatasetColumnType, Field["type"]> = {
  string: "str",
  boolean: "bool",
  number: "float",
  date: "str",
  json: "dict",
  spans: "dict",
  rag_contexts: "dict",
  chat_messages: "dict",
  annotations: "dict",
  evaluations: "dict",
};

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
  dataset: InMemoryDataset
): NodeDataset {
  return dataset.datasetId
    ? {
        id: dataset.datasetId,
        name: dataset.name,
      }
    : {
        name: dataset.name,
        inline: {
          records: transpostRowsFirstToColumnsFirstWithoutId(
            dataset.datasetRecords
          ),
          columnTypes: dataset.columnTypes,
        },
      };
}

export const simpleRecordListToNodeDataset = (
  records: Record<string, any>[]
): NodeDataset => {
  const columnsFirst = transpostRowsFirstToColumnsFirstWithoutId(
    records as DatasetRecordEntry[]
  );
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
  dataset: Dataset & { datasetRecords: DatasetRecord[] }
): InMemoryDataset => {
  const columns = (dataset.columnTypes ?? []) as DatasetColumns;
  const datasetRecords = dataset.datasetRecords.map((record) => {
    const row: DatasetRecordEntry = { id: record.id };
    columns.forEach((col) => {
      const value = dataset.id
        ? (record.entry as Record<string, any>)?.[col.name]
        : (record as DatasetRecordEntry)[col.name];
      row[col.name] = typeof value === "object" ? JSON.stringify(value) : value;
    });
    return row;
  });

  return {
    name: dataset.name,
    datasetRecords,
    columnTypes: dataset.columnTypes as DatasetColumns,
  };
};

export const trainTestSplit = (
  list: any[],
  { trainSize, testSize }: { trainSize: number; testSize: number }
) => {
  const total = list.length;
  const isPercentage = trainSize < 1 || testSize < 1;
  const train_count = isPercentage ? Math.floor(total * trainSize) : trainSize;
  const test_count = isPercentage ? Math.ceil(total * testSize) : testSize;

  return {
    train: list.slice(0, train_count),
    test: list.slice(train_count, train_count + test_count),
  };
};
