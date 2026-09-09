import type {
  CopyDatasetInput,
  Dataset,
  DatasetApi,
  DatasetEntrySelection,
  DatasetLookupInput,
  DatasetWithRecords,
} from "@langwatch/dataset-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

export type DatasetWithRecordsInput = DatasetLookupInput & {
  limitMb?: number | null;
  entrySelection?: DatasetEntrySelection;
};

/**
 * The two dataset operations the workflow tests drive, recording what each was
 * asked for. Every other operation throws when called, so a workflow that
 * grows a new dataset dependency cannot pass a test in silence.
 */
export class TestDatasetService {
  readonly datasetReads: DatasetWithRecordsInput[] = [];
  readonly datasetCopies: CopyDatasetInput[] = [];

  /** The fixture the module is handed: this recorder over an API fixture. */
  readonly api: DatasetApi;

  constructor(
    private readonly datasetWithRecords?: DatasetWithRecords,
    private readonly copiedDataset?: Dataset,
  ) {
    this.api = createApiFixture<DatasetApi>(
      {
        getDatasetWithRecords: (input: DatasetWithRecordsInput) =>
          this.getDatasetWithRecords(input),
        copyDataset: (input: CopyDatasetInput) => this.copyDataset(input),
      },
      "DatasetApi",
    );
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
}
