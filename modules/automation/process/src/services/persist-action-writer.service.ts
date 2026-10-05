import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { DatasetApi, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { DispatchError } from "@langwatch/eventing";

import { AutomationPersistActionRepository } from "../repositories/automation-persist-action.repository.ts";

const ANNOTATOR_REFERENCE_INVALID = "annotation_annotator_reference_invalid";

/** The two persist writes, through the dataset and annotation owners' own operations. */
export class PersistActionWriterService extends AutomationPersistActionRepository {
  static create(peers: {
    datasets: Pick<DatasetApi, "batchCreateRecords">;
    annotations: Pick<AnnotationApi, "queueTraces">;
  }): PersistActionWriterService {
    return new PersistActionWriterService(peers);
  }

  private constructor(
    private readonly peers: Readonly<{
      datasets: Pick<DatasetApi, "batchCreateRecords">;
      annotations: Pick<AnnotationApi, "queueTraces">;
    }>,
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
          "This automation names an annotator that parses as neither a queue nor a member, so a queue item cannot be written for it. Re-save the automation with a queue or a member that still exists.",
        retryable: false,
      });
    }
  }

  async addToDataset(input: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }): Promise<void> {
    await this.peers.datasets.batchCreateRecords({
      slugOrId: input.datasetId,
      projectId: input.projectId,
      entries: input.datasetRecords,
    });
  }
}

function readCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
