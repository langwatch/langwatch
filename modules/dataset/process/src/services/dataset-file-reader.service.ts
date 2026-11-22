/**
 * An uploaded CSV, JSON or JSONL file, read one row at a time as its bytes
 * arrive. JSONL and CSV hold one row in memory; a `.json` array is read whole.
 * @see specs/datasets/dataset-limits.feature
 */
import { pipeline, Readable } from "node:stream";

import {
  dedupeHeaders,
  DatasetRowTooLargeError,
  formatDatasetByteLimit,
  formatDatasetRowLimit,
  UploadValidationError,
  type FileFormat,
} from "@langwatch/dataset-contract";
import Papa from "papaparse";

import { assertUploadFileWithinLimit } from "../rules/dataset-row-limits.rules.ts";

/** The limits one read is held to; an absent file limit leaves the file size to its source. */
export type DatasetFileReadLimits = {
  /** One JSONL line or one CSV row, as it sits in the file. */
  rowBytes: number;
  /** One `.json` array file. */
  jsonFileBytes: number;
  /** The whole file. */
  fileBytes?: number;
  /** How many rows the file may hold. */
  rowsMax?: number;
};

/** One row of the file; the CSV header row comes first, with an empty record. */
export type DatasetFileRow = { headers?: string[]; record: Record<string, unknown> };

/**
 * How many bytes the CSV parser is handed at a time. The parser reads a row
 * that spans several pieces again from its start on every piece, so large
 * pieces keep a row with a file inline from being read thousands of times.
 */
const CSV_PIECE_BYTES = 4 * 1024 * 1024;

/** How many pieces the parser may hold unread before an unfinished row counts as over the limit. */
const CSV_PIECES_IN_FLIGHT = 4;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const NULL_BYTE = "\u0000";

export class DatasetFileReaderService {
  static create(limits: DatasetFileReadLimits): DatasetFileReaderService {
    return new DatasetFileReaderService(limits);
  }

  private constructor(private readonly limits: DatasetFileReadLimits) {}

  /** The file's rows in order. `sizeBytes` is the size the source already knows, if any. */
  async *rows(input: {
    bytes: AsyncIterable<Uint8Array | string>;
    format: FileFormat;
    sizeBytes?: number;
  }): AsyncGenerator<DatasetFileRow> {
    if (input.sizeBytes !== undefined) {
      assertUploadFileWithinLimit(input.sizeBytes, this.limits.fileBytes);
    }
    let rows = 0;
    for await (const row of this.formatRows(input)) {
      if (!row.headers) rows += 1;
      if (this.limits.rowsMax !== undefined && rows > this.limits.rowsMax) {
        throw new UploadValidationError(
          `The file holds more than the ${formatDatasetRowLimit(this.limits.rowsMax)} rows one upload accepts`,
          "row_limit_exceeded",
        );
      }
      yield row;
    }
  }

  private async *formatRows(input: {
    bytes: AsyncIterable<Uint8Array | string>;
    format: FileFormat;
    sizeBytes?: number;
  }): AsyncGenerator<DatasetFileRow> {
    const body = this.withinFileLimit(input.bytes);
    if (input.format === "csv") {
      yield* this.csvRows(body);
      return;
    }
    if (input.format === "json") {
      if (input.sizeBytes !== undefined) this.assertJsonFileSize(input.sizeBytes);
      yield* recordsOf(parseUploadedJson(scrub(await this.textOf(body)).trim()));
      return;
    }
    yield* this.jsonlRows(body);
  }

  /** The body as it arrives, refused once it passes the file limit rather than read to the end. */
  private async *withinFileLimit(
    body: AsyncIterable<Uint8Array | string>,
  ): AsyncGenerator<Uint8Array> {
    const maxBytes = this.limits.fileBytes;
    let seen = 0;
    for await (const part of body) {
      const bytes = typeof part === "string" ? Buffer.from(part, "utf8") : part;
      seen += bytes.byteLength;
      assertUploadFileWithinLimit(seen, maxBytes);
      yield bytes;
    }
  }

  /** One record per line. A file that opens with `[` holds one array, and is read whole. */
  private async *jsonlRows(body: AsyncIterable<Uint8Array>): AsyncGenerator<DatasetFileRow> {
    const lines = this.lines(body);
    for await (const rawLine of lines) {
      const line = scrub(rawLine).trim();
      if (line === "") continue;
      if (line.startsWith("[")) {
        yield* recordsOf(parseUploadedJson(await this.restOf(line, lines)));
        return;
      }
      yield { record: parseUploadedJson(line) as Record<string, unknown> };
    }
  }

  /** The body split at newlines, a line refused as soon as it passes the row limit. */
  private async *lines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
    let parts: Uint8Array[] = [];
    let partBytes = 0;
    const take = (): string => {
      const line = Buffer.concat(parts, partBytes);
      parts = [];
      partBytes = 0;
      const end = line.at(-1) === CARRIAGE_RETURN ? line.byteLength - 1 : line.byteLength;

      return line.toString("utf8", 0, end);
    };
    const keep = (part: Uint8Array): void => {
      partBytes += part.byteLength;
      if (partBytes > this.limits.rowBytes) {
        throw new DatasetRowTooLargeError({ maxBytes: this.limits.rowBytes, measure: "uploaded" });
      }
      if (part.byteLength > 0) parts.push(part);
    };

    for await (const piece of body) {
      let start = 0;
      for (let end = piece.indexOf(NEWLINE); end !== -1; end = piece.indexOf(NEWLINE, start)) {
        keep(piece.subarray(start, end));
        yield take();
        start = end + 1;
      }
      keep(piece.subarray(start));
    }
    if (partBytes > 0) yield take();
  }

  /** An array file's first line and every line after it, as one text within the `.json` limit. */
  private async restOf(firstLine: string, rest: AsyncIterable<string>): Promise<string> {
    const parts = [firstLine];
    let seen = Buffer.byteLength(firstLine, "utf8");
    for await (const line of rest) {
      seen += Buffer.byteLength(line, "utf8") + 1;
      this.assertJsonFileSize(seen);
      parts.push(scrub(line));
    }

    return parts.join("\n");
  }

  /** The whole body as one text, refused once it passes the `.json` limit. */
  private async textOf(body: AsyncIterable<Uint8Array>): Promise<string> {
    const decoder = new TextDecoder("utf-8");
    const parts: string[] = [];
    let seen = 0;
    for await (const part of body) {
      seen += part.byteLength;
      this.assertJsonFileSize(seen);
      parts.push(decoder.decode(part, { stream: true }));
    }
    parts.push(decoder.decode());

    return parts.join("");
  }

  private assertJsonFileSize(sizeBytes: number): void {
    if (sizeBytes <= this.limits.jsonFileBytes) return;
    throw new UploadValidationError(
      `A .json file larger than ${formatDatasetByteLimit(this.limits.jsonFileBytes)} is not supported. ` +
        "Convert it to JSONL, one object per line, to import a larger file.",
      "file_too_large",
    );
  }

  /**
   * Rows as arrays mapped by index, the header row deduplicated once. The
   * parser's own header mode renames equal cells of a data row when it resumes.
   */
  private async *csvRows(body: AsyncIterable<Uint8Array>): AsyncGenerator<DatasetFileRow> {
    const rowBytes = this.limits.rowBytes;
    const progress: CsvProgress = { fedBytes: 0, fedAtLastRow: 0 };
    const parsed = pipeline(
      Readable.from(csvPieces(body, progress, rowBytes), { objectMode: true, highWaterMark: 1 }),
      Papa.parse(Papa.NODE_STREAM_INPUT, { header: false, skipEmptyLines: true }),
      () => undefined,
    );
    let headers: string[] | undefined;
    for await (const values of parsed) {
      progress.fedAtLastRow = progress.fedBytes;
      const cells = cellsOf(values);
      if (!headers) {
        headers = dedupeHeaders(cells);
        yield { headers, record: {} };
        continue;
      }
      if (cellBytesOf(cells) > rowBytes) throw refusedRow(rowBytes);
      yield { record: Object.fromEntries(headers.map((header, i) => [header, cells[i]])) };
    }
  }
}

/** How far the CSV parser has been fed, and where it stood when its last row ended. */
type CsvProgress = { fedBytes: number; fedAtLastRow: number };

function refusedRow(maxBytes: number): DatasetRowTooLargeError {
  return new DatasetRowTooLargeError({ maxBytes, measure: "uploaded" });
}

/**
 * The body as text in pieces of a fixed size. A stretch with no row ending
 * across everything fed since the last one is one row over the limit.
 */
async function* csvPieces(
  body: AsyncIterable<Uint8Array>,
  progress: CsvProgress,
  rowBytes: number,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let pending: string[] = [];
  let pendingBytes = 0;
  const feed = (): string => {
    const piece = pending.join("");
    progress.fedBytes += pendingBytes;
    pending = [];
    pendingBytes = 0;
    const unfinished = progress.fedBytes - progress.fedAtLastRow;
    if (unfinished > rowBytes + CSV_PIECES_IN_FLIGHT * CSV_PIECE_BYTES) throw refusedRow(rowBytes);

    return piece;
  };
  for await (const part of body) {
    pending.push(decoder.decode(part, { stream: true }));
    pendingBytes += part.byteLength;
    if (pendingBytes >= CSV_PIECE_BYTES) yield feed();
  }
  pending.push(decoder.decode());
  if (pendingBytes > 0) yield feed();
}

function cellsOf(values: unknown): string[] {
  return (Array.isArray(values) ? values : []).map((value) =>
    scrub(value == null ? "" : String(value)),
  );
}

function* recordsOf(parsed: unknown): Generator<DatasetFileRow> {
  if (!Array.isArray(parsed)) {
    throw new UploadValidationError(
      "JSON content must be an array of objects",
      "unsupported_format",
    );
  }
  for (const record of parsed) yield { record: record as Record<string, unknown> };
}

/** Unparseable uploaded JSON is the customer's file, not a server fault. */
function parseUploadedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new UploadValidationError(
      `The file is not valid JSON: ${error.message}`,
      "unsupported_format",
    );
  }
}

/** JSON and Postgres both refuse U+0000 inside a string, so it is dropped as the text is read. */
function scrub(text: string): string {
  return text.includes(NULL_BYTE) ? text.replaceAll(NULL_BYTE, "") : text;
}

function cellBytesOf(cells: readonly string[]): number {
  let bytes = 0;
  for (const cell of cells) bytes += Buffer.byteLength(cell, "utf8");

  return bytes;
}
