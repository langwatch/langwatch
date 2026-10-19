import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { DatasetApi, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { DispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import { AutomationPersistActionRepository } from "../../../repositories/automation-persist-action.repository.ts";

const ANNOTATOR_REFERENCE_INVALID = "annotation_annotator_reference_invalid";

type DatasetPeer = Pick<DatasetApi, "batchCreateRecords" | "findBySlugOrId">;

/** The two persist writes, through the dataset and annotation owners' own operations. */
export class PersistActionWriterService extends AutomationPersistActionRepository {
  static create(peers: {
    datasets: DatasetPeer;
    annotations: Pick<AnnotationApi, "queueTraces">;
    logger?: Logger;
  }): PersistActionWriterService {
    return new PersistActionWriterService(
      peers,
      peers.logger ?? createLogger("langwatch:automation:persist-action-writer"),
    );
  }

  private constructor(
    private readonly peers: Readonly<{
      datasets: DatasetPeer;
      annotations: Pick<AnnotationApi, "queueTraces">;
    }>,
    private readonly logger: Logger,
  ) {
    super();
  }

  async addToAnnotationQueue(input: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }): Promise<void> {
    try {
      await this.peers.annotations.queueTraces(input);
    } catch (error) {
      // The annotator is saved on the automation, so a malformed one fails every redelivery.
      if (readCode(error) !== ANNOTATOR_REFERENCE_INVALID) throw error;
      throw new DispatchError({
        message:
          "This automation names an annotator that parses as neither a queue nor a member, so a queue item " +
          "cannot be written for it. Re-save the automation with a queue or a member that still exists.",
        retryable: false,
      });
    }
  }

  async addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
    triggerId: string;
  }): Promise<void> {
    const dataset = await this.peers.datasets.findBySlugOrId({
      slugOrId: input.datasetId,
      projectId: input.projectId,
    });
    if (!dataset) {
      this.logger.warn(
        { triggerId: input.triggerId, datasetId: input.datasetId },
        "ADD_TO_DATASET dataset is gone or archived; the match was dropped",
      );
      throw datasetRefusal({
        datasetId: input.datasetId,
        reason: "it is gone or archived",
      });
    }

    // A mapping saved before a column was removed still names it; the row is kept without it.
    const columns = new Set(dataset.columnTypes.map((column) => column.name));
    const dropped = new Set<string>();
    const entries = input.datasetRecords.map((record) => keepDefined({ record, columns, dropped }));
    if (dropped.size > 0) {
      this.logger.warn(
        {
          triggerId: input.triggerId,
          datasetId: input.datasetId,
          droppedColumns: [...dropped],
        },
        "ADD_TO_DATASET mapping names columns the dataset no longer has; they were dropped",
      );
    }

    // A record left with only its id would be stored as an all-empty row and reported as a success.
    const leftEmpty = entries.some(holdsOnlyId);
    if (leftEmpty) {
      throw datasetRefusal({
        datasetId: input.datasetId,
        reason: "none of the mapped columns exist in it any more",
      });
    }

    try {
      await this.peers.datasets.batchCreateRecords({
        slugOrId: input.datasetId,
        projectId: input.projectId,
        entries,
      });
    } catch (error) {
      // A column refusal here means one was removed since the trim: a redelivery re-reads them.
      if (readCode(error) !== "dataset_not_found") throw error;
      throw datasetRefusal({
        datasetId: input.datasetId,
        reason: "it is gone or archived",
        cause: error,
      });
    }
  }
}

function keepDefined({
  record,
  columns,
  dropped,
}: {
  record: DatasetRecordEntry;
  columns: ReadonlySet<string>;
  dropped: Set<string>;
}): DatasetRecordEntry {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || columns.has(key)) kept[key] = value;
    else dropped.add(key);
  }

  return kept as DatasetRecordEntry;
}

/** The dataset refused the write for a reason a redelivery cannot change. */
function datasetRefusal({
  datasetId,
  reason,
  cause,
}: {
  datasetId: string;
  reason: string;
  cause?: unknown;
}): DispatchError {
  return new DispatchError({
    message:
      `The dataset "${datasetId}" this automation appends to refused the rows: ${reason}. ` +
      "Re-save the automation with a dataset and mapping that exist.",
    retryable: false,
    cause,
  });
}

function readCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function holdsOnlyId(entry: Record<string, unknown>): boolean {
  return Object.keys(entry).every((key) => key === "id");
}
