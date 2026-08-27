import {
  DatasetService,
  type CopyDatasetInput,
  type Dataset,
  type DatasetEntrySelection,
  type DatasetLookupInput,
  type DatasetWithRecords,
} from "@langwatch/dataset-contract";

export type DatasetWithRecordsInput = DatasetLookupInput & {
  limitMb?: number | null;
  entrySelection?: DatasetEntrySelection;
};

export class TestDatasetService extends DatasetService {
  readonly datasetReads: DatasetWithRecordsInput[] = [];
  readonly datasetCopies: CopyDatasetInput[] = [];

  constructor(
    private readonly datasetWithRecords?: DatasetWithRecords,
    private readonly copiedDataset?: Dataset,
  ) {
    super();
  }

  getDatasetWithRecords(input: DatasetWithRecordsInput): Promise<DatasetWithRecords> {
    this.datasetReads.push(input);
    if (!this.datasetWithRecords) {
      throw new Error("No Dataset read was configured for this test.");
    }

    return Promise.resolve(this.datasetWithRecords);
  }

  copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    this.datasetCopies.push(input);
    if (!this.copiedDataset) {
      throw new Error("No Dataset copy was configured for this test.");
    }

    return Promise.resolve(this.copiedDataset);
  }

  upsertDataset(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  validateDatasetName(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  findNextAvailableName(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getBySlugOrId(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getByIds(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  renameDataset(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  listDatasets(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  archiveDataset(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  restoreDataset(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  updateMapping(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  listRecords(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getDatasetPage(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  getDatasetHead(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  upsertRecord(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  batchCreateRecords(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  deleteRecords(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  uploadToExistingDataset(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  createDatasetFromUpload(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  createPendingUpload(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  writeStagedUpload(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  abortPendingUpload(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  finalizeUpload(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }

  retryNormalize(): Promise<never> {
    throw new Error("Not used by Workflow tests.");
  }
}
