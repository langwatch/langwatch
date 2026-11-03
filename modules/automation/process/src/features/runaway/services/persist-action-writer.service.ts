import type { AnnotationApi } from "@langwatch/annotation-contract";
import { AutomationDatasetUnavailableError } from "@langwatch/automation-contract";
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
    traceId: string;
  }): Promise<void> {
    const dataset = await this.peers.datasets.findBySlugOrId({
      slugOrId: input.datasetId,
      projectId: input.projectId,
    });
    if (!dataset) {
      throw new AutomationDatasetUnavailableError({
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
      throw new AutomationDatasetUnavailableError({
        datasetId: input.datasetId,
        reason: "none of the mapped columns exist in it any more",
      });
    }

    try {
      const written = await this.peers.datasets.batchCreateRecords({
        slugOrId: input.datasetId,
        projectId: input.projectId,
        entries,
        // Record ids are deterministic per trigger, trace and row, so a page retry that
        // re-runs a trace whose rows already landed is already done, not a failure.
        skipDuplicates: true,
        // Also return rows an earlier attempt stored, so the retry can compare their
        // content with the row this mapping produces now instead of trusting the id.
        readBackExisting: true,
      });
      // DatasetRecord.id is globally unique, but the readback is scoped to this dataset:
      // an id that already belongs to a different dataset is skipped by skipDuplicates and
      // never comes back, so the automation would report a row it never added.
      const requested = new Set(entries.map((entry) => entry.id));
      const storedById = new Map(written.map((record) => [record.id, record]));
      const missing = [...requested].filter((id) => !storedById.has(id));
      if (missing.length > 0) {
        throw new DispatchError({
          message:
            `The dataset write skipped ${missing.length} row(s) whose id already belongs to another ` +
            `dataset (${missing.slice(0, 3).join(", ")}); retarget this automation's dataset or clear those ids.`,
          retryable: false,
        });
      }

      // A deterministic id only identifies a row while the mapping and expansions that
      // produced it stay the same. If the trigger was edited between the first write and
      // this retry, skipDuplicates would keep the old row and silently drop the new
      // content, so compare the stored row with what this attempt would write and fail
      // terminally instead of claiming a row that does not hold the new mapping.
      const mappedColumns = [
        ...new Set(input.datasetRecords.flatMap((record) => Object.keys(record))),
      ].filter((column) => column !== "id");
      const changed = entries.find((entry) => {
        const storedRecord = storedById.get(entry.id as string);
        if (storedRecord === undefined) {
          return false;
        }

        return (
          canonicalEntry(entry, mappedColumns) !== canonicalEntry(storedRecord.entry, mappedColumns)
        );
      });
      if (changed !== undefined) {
        throw new DispatchError({
          message:
            `The mapping for trigger ${input.triggerId} changed after trace ${input.traceId}'s rows ` +
            `were first written; row ${String(changed.id)} now maps to different content. Restore the ` +
            "mapping that wrote it, or clear those rows, before retrying.",
          retryable: false,
        });
      }
    } catch (error) {
      // A column refusal here means one was removed since the trim: a redelivery re-reads them.
      // It is a customer-fault handled error, which the outbox would retire as dead, so it is
      // rethrown as a retryable dispatch failure.
      if (readCode(error) === "dataset_invalid_column") {
        throw new DispatchError({
          message:
            `The dataset "${input.datasetId}" this automation appends to lost a column while the ` +
            "rows were written; the redelivery reads its columns again.",
          retryable: true,
          cause: error,
        });
      }
      if (readCode(error) !== "dataset_not_found") throw error;
      throw new AutomationDatasetUnavailableError({
        datasetId: input.datasetId,
        reason: "it is gone or archived",
        cause: error instanceof Error ? error : undefined,
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

function readCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function holdsOnlyId(entry: Record<string, unknown>): boolean {
  return Object.keys(entry).every((key) => key === "id");
}

/** One comparable form of a mapped row: every dataset column, null when absent. */
function canonicalEntry(entry: Record<string, unknown>, columns: readonly string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const column of [...columns].toSorted()) {
    normalized[column] = entry[column] ?? null;
  }

  return JSON.stringify(normalized);
}
