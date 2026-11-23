// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type Compressors, parquetMetadata, parquetReadObjects, snappyUncompress } from "hyparquet";
import { compressors } from "hyparquet-compressors";

/**
 * Caps on one object's decoded size: a small Parquet file can inflate to many times its bytes,
 * through compression or through dictionary and run-length encoding on an uncompressed page.
 * `maxDecompressedBytes` bounds the page bytes and, separately, the decoded values.
 */
export type SecurityLakeDecodeLimits = { maxDecompressedBytes: number; maxRows: number };
export const DEFAULT_DECODE_LIMITS: SecurityLakeDecodeLimits = {
  maxDecompressedBytes: 128 * 1024 * 1024,
  maxRows: 250_000,
};

/** A file past a decode cap: reading it again gives the same answer, so it goes straight to poison. */
export class DecodeLimitError extends Error {}

/** The decompressors, each refusing a page before it takes the object past the byte cap. */
function cappedCompressors(maxDecompressedBytes: number): Compressors {
  let total = 0;
  const withSnappy: Compressors = {
    SNAPPY: (input, outputLength) => {
      const output = new Uint8Array(outputLength);
      snappyUncompress(input, output);
      return output;
    },
    ...(compressors as Compressors),
  };
  const capped: Compressors = {};
  for (const [codec, decompress] of Object.entries(withSnappy)) {
    if (decompress === undefined) continue;
    capped[codec as keyof Compressors] = (input, outputLength) => {
      total += outputLength;
      if (total > maxDecompressedBytes) {
        throw new DecodeLimitError(
          `decompressed size passes the ${maxDecompressedBytes}-byte limit for one object`,
        );
      }
      return decompress(input, outputLength);
    };
  }
  return capped;
}

/** The bytes one decoded value holds, counted until it passes `budget`. */
function decodedBytes(value: unknown, budget: number): number {
  let total = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && total <= budget) {
    const next = stack.pop();
    if (typeof next === "string") total += next.length;
    else if (next instanceof Uint8Array) total += next.byteLength;
    else if (Array.isArray(next)) {
      total += 1;
      stack.push(...next);
    } else if (next !== null && typeof next === "object" && !(next instanceof Date)) {
      for (const [key, field] of Object.entries(next)) {
        total += key.length;
        stack.push(field);
      }
    } else total += 8;
  }
  return total;
}

/** The object's bytes as the `ArrayBuffer` hyparquet reads, copied only when it is a view of a larger one. */
export function wholeArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer } = bytes;
  if (
    buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
  ) {
    return buffer;
  }
  return bytes.slice().buffer;
}

/**
 * Decodes one Parquet file one row group at a time within the caps: refused from its footer when
 * it declares too many rows or bytes, and as soon as the values decoded so far pass the byte cap.
 */
export async function* decodeParquetRowGroups({
  file,
  limits,
}: {
  file: ArrayBuffer;
  limits: SecurityLakeDecodeLimits;
}): AsyncGenerator<Record<string, unknown>[]> {
  const metadata = parquetMetadata(file);
  const rows = metadata.row_groups.reduce((sum, group) => sum + Number(group.num_rows), 0);
  if (rows > limits.maxRows || Number(metadata.num_rows) > limits.maxRows) {
    throw new DecodeLimitError(`${rows} rows pass the ${limits.maxRows}-row limit for one object`);
  }
  const declared = metadata.row_groups
    .flatMap((group) => group.columns)
    .reduce((sum, column) => sum + Number(column.meta_data?.total_uncompressed_size ?? 0), 0);
  if (declared > limits.maxDecompressedBytes) {
    throw new DecodeLimitError(
      `decompressed size passes the ${limits.maxDecompressedBytes}-byte limit for one object`,
    );
  }
  const compressors = cappedCompressors(limits.maxDecompressedBytes);
  let decodedTotal = 0;
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows);
    if (rowEnd > rowStart) {
      const decoded = await parquetReadObjects({ file, metadata, rowStart, rowEnd, compressors });
      for (const row of decoded) {
        decodedTotal += decodedBytes(row, limits.maxDecompressedBytes - decodedTotal);
        if (decodedTotal > limits.maxDecompressedBytes) {
          throw new DecodeLimitError(
            `decoded size passes the ${limits.maxDecompressedBytes}-byte limit for one object`,
          );
        }
      }
      yield decoded;
    }
    rowStart = rowEnd;
  }
}
