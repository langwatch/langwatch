import type { BatchEvaluationRepository } from "./batch-evaluation.repository.ts";
import type { DatasetChunkRepository } from "./dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "./dataset-content.repository.ts";
import type { DatasetCountRepository } from "./dataset-count.repository.ts";
import type { DatasetMigrationRepository } from "./dataset-migration.repository.ts";
import type { DatasetRecordContentRepository } from "./dataset-record-content.repository.ts";
import type { DatasetRecordRepository } from "./dataset-record.repository.ts";
import type { DatasetSingleFileRepository } from "./dataset-single-file.repository.ts";
import type { DatasetVersionContentRepository } from "./dataset-version-content.repository.ts";
import type { DatasetVersionRepository } from "./dataset-version.repository.ts";
import type { DatasetRepository } from "./dataset.repository.ts";

export interface DatasetRepositories {
  /** Dataset rows as the feature's own `Dataset` shape. */
  readonly datasets: DatasetRepository;
  /** Entries in the relational table, for a postgres-layout dataset. */
  readonly records: DatasetRecordRepository;
  /** Dataset rows as stored, plus the counters an object-backed dataset keeps. */
  readonly content: DatasetContentRepository;
  /** The entries an upload appends. */
  readonly recordContent: DatasetRecordContentRepository;
  /** The batch-evaluation rows an experiment's runs are summarised by. */
  readonly batchEvaluations: BatchEvaluationRepository;
  /** The usage report's counts over the three tables above. */
  readonly count: DatasetCountRepository;
  /** The object-storage chunks an object-backed dataset's entries live in. */
  readonly chunks: DatasetChunkRepository;
  /** The one-off content move only the dataset:move-content-to-object-storage step runs. */
  readonly migration: DatasetMigrationRepository;
  /** The chunk store that move writes into. */
  readonly migrationChunks: DatasetChunkRepository;
  /** The previous release's single-file datasets, read and rewritten where it kept them. */
  readonly singleFiles: DatasetSingleFileRepository;
  /** The numbered snapshots of each dataset and the runs that read them. */
  readonly versions: DatasetVersionRepository;
  /** The rows of each snapshot, in object storage beside the dataset's chunks. */
  readonly versionContent: DatasetVersionContentRepository;
}
