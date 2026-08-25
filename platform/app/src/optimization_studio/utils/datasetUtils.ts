/** App compatibility boundary for the portable Workflow Studio dataset helpers. */
export {
  datasetColumnTypeToFieldType,
  datasetColumnsToFields,
  datasetDatabaseRecordsToInMemoryDataset,
  fieldsToDatasetColumns,
  inMemoryDatasetToNodeDataset,
  simpleRecordListToNodeDataset,
  trainTestSplit,
  transposeColumnsFirstToRowsFirstWithId,
  transpostRowsFirstToColumnsFirstWithoutId,
  tryToMapPreviousColumnsToNewColumns,
} from "@langwatch/workflow-web";
