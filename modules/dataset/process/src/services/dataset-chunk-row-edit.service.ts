/**
 * The in-place edit of one chunk row, run inside the lock the chunk service took: the located
 * chunk first, then every chunk in order. Null means no chunk holds the id.
 */
import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import {
  type ChunkLine,
  type DatasetMutationRecord,
  isChunkLine,
  readOffsets,
} from "../rules/dataset-chunk-lines.rules.ts";

const logger = createLogger("langwatch:datasets:mutations");

/** What the off-lock locate scan reported, or null when it was skipped or abandoned. */
export type LocateHint = { affectedIndices: number[]; locatedIds: Set<string> } | null;

/** The one row an edit targets, together with the lock's transaction and re-read row. */
export type EditTarget = {
  tx: DatasetContentRepository;
  current: DatasetMutationRecord;
  dataset: DatasetMutationRecord;
  projectId: string;
  recordId: string;
  entry: unknown;
  storage: DatasetChunkRepository;
};

export class DatasetChunkRowEditService {
  static create(): DatasetChunkRowEditService {
    return new DatasetChunkRowEditService();
  }

  private constructor() {}

  /** `edited` when the row was rewritten where it is; `absent` when no chunk holds its id. */
  async editInPlace(target: EditTarget & { hint: LocateHint }): Promise<"edited" | "absent"> {
    const edited = (await this.editHintedChunk(target)) ?? (await this.editByFullScan(target));
    return edited ? "edited" : "absent";
  }

  /**
   * Replace the row's entry at (index, rowIndex) in place and patch only that chunk's
   * byteSize — rows don't move on edit, so startRow/endRow are unchanged. Shared by the
   * hinted and full-scan branches.
   */
  private async rewriteRowAt({
    tx,
    current,
    dataset,
    projectId,
    recordId,
    entry,
    storage,
    index,
    rows,
    rowIndex,
  }: EditTarget & { index: number; rows: unknown[]; rowIndex: number }): Promise<void> {
    const offsets = readOffsets(current);
    const updatedRows = rows.slice();
    updatedRows[rowIndex] = { id: recordId, entry } satisfies ChunkLine;
    const offset = await storage.rewriteChunk({
      projectId,
      datasetId: dataset.id,
      index,
      records: updatedRows,
    });
    const oldByteSize = offsets[index]?.byteSize ?? 0;
    const patched = offsets.map((o) =>
      o.index === index ? { ...o, byteSize: offset.byteSize } : o,
    );
    await tx.updateContent({
      id: dataset.id,
      projectId,
      content: {
        sizeBytes: (current.sizeBytes ?? 0n) + BigInt(offset.byteSize - oldByteSize),
        chunkOffsets: patched,
      },
    });
  }

  /**
   * Fast path — the pre-scan located the row and the offset index covers every chunk, so
   * only that one chunk is re-read under the lock. Null means the hint did not hold and the
   * caller falls through to the full scan.
   */
  private async editHintedChunk(
    target: EditTarget & { hint: LocateHint },
  ): Promise<{ updated: true } | null> {
    const { current, dataset, projectId, recordId, storage, hint } = target;
    const chunkCount = current.chunkCount ?? 0;
    const offsets = readOffsets(current);
    if (!hint?.locatedIds.has(recordId) || offsets.length !== chunkCount) {
      return null;
    }

    const index = hint.affectedIndices[0]!;
    if (index >= chunkCount) {
      return null;
    }

    const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
    const rowIndex = rows.findIndex((line) => isChunkLine(line) && line.id === recordId);
    if (rowIndex === -1) {
      // Row moved/removed since the scan → fall through to the full scan.
      logger.warn(
        { projectId, datasetId: dataset.id, recordId, index },
        "edit fast-path drift: located row not in hinted chunk; falling back to full in-lock scan",
      );

      return null;
    }

    await this.rewriteRowAt({ ...target, index, rows, rowIndex });

    return { updated: true };
  }

  /**
   * The proven path: read chunks in order until the id is found and rewrite it in place.
   * Null means the id exists in no chunk, so the caller appends it as a new row.
   */
  private async editByFullScan(target: EditTarget): Promise<{ updated: true } | null> {
    const { current, dataset, projectId, recordId, storage } = target;
    const chunkCount = current.chunkCount ?? 0;
    for (let index = 0; index < chunkCount; index++) {
      const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
      const rowIndex = rows.findIndex((line) => isChunkLine(line) && line.id === recordId);
      if (rowIndex === -1) {
        continue;
      }

      await this.rewriteRowAt({ ...target, index, rows, rowIndex });

      return { updated: true };
    }

    return null;
  }
}
