import { nanoid } from "nanoid";
import type {
  DatasetColumns,
  DatasetColumnType,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import type { Entry, Field } from "../types/dsl";
import type { InMemoryDataset } from "../../components/datasets/DatasetTable";

export function transposeIDlessColumnsFirstToRowsFirstWithId(
  data: Record<string, string[]>
): DatasetRecordEntry[] {
  return Object.entries(data).reduce((acc, [column, values]) => {
    values.forEach((value, index) => {
      acc[index] = acc[index] ?? { id: nanoid() };
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

export function fieldTypesToDatasetColumns(fields: Field[]): DatasetColumns {
  return fields.map((field) => ({
    name: field.identifier,
    type: fieldToColumnTypeMap[field.type],
  }));
}

export function datasetColumnsToFieldTypes(columns: DatasetColumns): Field[] {
  return columns.map((column) => ({
    identifier: column.name,
    type: columnTypeToFieldTypeMap[column.type],
  }));
}

export function inMemoryDatasetToNodeDataset(
  dataset: InMemoryDataset
): Entry["dataset"] {
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
