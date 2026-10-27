import type {
  DatasetColumns,
  DatasetVersion,
  DatasetVersionRunLink,
  DatasetVersionTrigger,
} from "@langwatch/dataset-contract";

/** A version as the service writes it; `version` is the next number the service chose. */
export type NewDatasetVersion = {
  id: string;
  projectId: string;
  datasetId: string;
  version: number;
  name: string | null;
  trigger: DatasetVersionTrigger;
  contentHash: string;
  columnTypes: DatasetColumns;
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  restoredFromVersion: number | null;
  authorId: string | null;
  authorKind: "user" | "api_key" | "system" | null;
  pinned: boolean;
};

/** One dataset holding versions old enough for retention to look at. */
export type DatasetWithVersionHistory = { projectId: string; datasetId: string };

/** The numbered snapshots of a dataset and the experiment runs that read them. */
export interface DatasetVersionRepository {
  findLatest(input: { projectId: string; datasetId: string }): Promise<DatasetVersion | null>;
  findByNumber(input: {
    projectId: string;
    datasetId: string;
    version: number;
  }): Promise<DatasetVersion | null>;
  /** Every version of the dataset, newest first. */
  findAll(input: { projectId: string; datasetId: string }): Promise<DatasetVersion[]>;
  /** Refuses with `DatasetVersionNumberTakenError` when the number was taken concurrently. */
  create(input: NewDatasetVersion): Promise<DatasetVersion>;
  rename(input: { projectId: string; id: string; name: string }): Promise<DatasetVersion>;
  pin(input: { projectId: string; id: string }): Promise<DatasetVersion>;
  /** Records which version each named dataset a run read; a repeat is a no-op. */
  linkRun(input: {
    projectId: string;
    runId: string;
    experimentId: string | null;
    versions: readonly { datasetId: string; versionId: string }[];
  }): Promise<void>;
  findRunLinks(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<DatasetVersionRunLink[]>;
  /** One page, by dataset id, of datasets with more than one version older than `olderThanMs`. */
  findDatasetsWithHistory(input: {
    afterDatasetId: string | null;
    olderThanMs: number;
    limit: number;
  }): Promise<DatasetWithVersionHistory[]>;
  /** Whether the dataset holds any version at all, for the first-version step. */
  hasAny(input: { projectId: string; datasetId: string }): Promise<boolean>;
  deleteMany(input: { projectId: string; ids: readonly string[] }): Promise<number>;
}

/** Another writer saved the same version number first; the service picks the next one. */
export class DatasetVersionNumberTakenError extends Error {
  constructor() {
    super("The dataset version number was taken by a concurrent save");
    this.name = "DatasetVersionNumberTakenError";
  }
}
