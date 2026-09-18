import type { BatchEvaluationRepository } from "./batch-evaluation.repository.ts";
import type { DatasetContentRepository } from "./dataset-content.repository.ts";
import type { DatasetRecordContentRepository } from "./dataset-record-content.repository.ts";
import type { DatasetRecordRepository } from "./dataset-record.repository.ts";
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
}
