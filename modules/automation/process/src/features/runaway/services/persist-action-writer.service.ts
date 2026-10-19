import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { DatasetApi, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { DispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import { AutomationPersistActionRepository } from "../../../repositories/automation-persist-action.repository.ts";

const ANNOTATOR_REFERENCE_INVALID = "annotation_annotator_reference_invalid";
const DATASET_REFUSALS = new Set(["dataset_invalid_column", "dataset_not_found"]);

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
    if (!dataset) throw datasetRefusal({ datasetId: input.datasetId });

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

    try {
      await this.peers.datasets.batchCreateRecords({
        slugOrId: input.datasetId,
        projectId: input.projectId,
        entries,
      });
    } catch (error) {
      const code = readCode(error);
      if (typeof code !== "string" || !DATASET_REFUSALS.has(code)) throw error;
      throw datasetRefusal({ datasetId: input.datasetId, cause: error });
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

  return { ...kept, id: record.id };
}

/** The dataset refused the write for a reason a redelivery cannot change. */
function datasetRefusal({
  datasetId,
  cause,
}: {
  datasetId: string;
  cause?: unknown;
}): DispatchError {
  return new DispatchError({
    message:
      `The dataset "${datasetId}" this automation appends to refused the rows: it is gone, archived, or ` +
      "no longer has the columns they name. Re-save the automation with a dataset and mapping that exist.",
    retryable: false,
    cause,
  });
}

function readCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
