/** Reading a dataset's stored chunk offsets, which arrive as untyped JSON. */
import { DatasetChunkCountMissingError, type Dataset } from "@langwatch/dataset-contract";

import type { ChunkOffset } from "./dataset-chunking.rules.ts";

/** The stored chunk offsets, or none when the stored value is not a list of offsets. */
export function readChunkOffsets(value: unknown): ChunkOffset[] {
  if (!Array.isArray(value)) return [];
  if (!value.every(isChunkOffset)) return [];
  return value.map((offset) => ({ ...offset, byteSize: offset.byteSize ?? 0 }));
}

/** The chunks a search scans, in order; a dataset without offsets scans every chunk. */
export function readSearchOffsets(dataset: Dataset): { index: number; byteSize: number | null }[] {
  const value = dataset.chunkOffsets;
  if (Array.isArray(value) && value.length > 0 && value.every(isSearchOffset)) {
    return value
      .map((offset) => ({
        index: offset.index,
        byteSize:
          typeof offset.byteSize === "number" &&
          Number.isFinite(offset.byteSize) &&
          offset.byteSize >= 0
            ? offset.byteSize
            : null,
      }))
      .toSorted((left, right) => left.index - right.index);
  }
  if (dataset.chunkCount === null) throw new DatasetChunkCountMissingError(dataset.id);
  return Array.from({ length: dataset.chunkCount }, (_, index) => ({
    index,
    byteSize: null,
  }));
}

function isSearchOffset(value: unknown): value is {
  index: number;
  startRow: number;
  endRow: number;
  byteSize?: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const offset = value as Record<string, unknown>;
  return (
    typeof offset.index === "number" &&
    typeof offset.startRow === "number" &&
    typeof offset.endRow === "number"
  );
}

function isChunkOffset(value: unknown): value is Omit<ChunkOffset, "byteSize"> & {
  byteSize?: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const offset = value as Record<string, unknown>;
  return (
    typeof offset.index === "number" &&
    typeof offset.startRow === "number" &&
    typeof offset.endRow === "number" &&
    (offset.byteSize === undefined || typeof offset.byteSize === "number")
  );
}
