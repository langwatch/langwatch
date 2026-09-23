import type { DatasetApi } from "@langwatch/dataset-contract";

const unused = async () => {
  throw new Error("unused dataset operation");
};

export function completeDatasetApi(overrides: Partial<DatasetApi> = {}): DatasetApi {
  return {
    upsertDataset: unused,
    countUsage: unused,
    validateDatasetName: unused,
    findNextAvailableName: unused,
    listDatasets: unused,
    getBySlugOrId: unused,
    findBySlugOrId: unused,
    getByIds: unused,
    renameDataset: unused,
    updateMapping: unused,
    archiveDataset: unused,
    restoreDataset: unused,
    copyDataset: unused,
    copyDatasetForActor: unused,
    getDatasetWithRecords: unused,
    getDatasetPage: unused,
    findDatasetPage: unused,
    getDatasetHead: unused,
    listRecords: unused,
    batchCreateRecords: unused,
    upsertRecord: unused,
    deleteRecords: unused,
    createDatasetFromUpload: unused,
    uploadToExistingDataset: unused,
    createPendingUpload: unused,
    writeStagedUpload: unused,
    finalizeUpload: unused,
    retryNormalize: unused,
    abortPendingUpload: unused,
    summariseBatchEvaluations: unused,
    listBatchEvaluations: unused,
    platformUrl: ({ projectSlug, path }) => `https://app.example.com/${projectSlug}${path}`,
    ...overrides,
  };
}
