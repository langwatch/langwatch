import { createHash, type Hash } from "node:crypto";

import type { DatasetColumns, DatasetVersionRow } from "@langwatch/dataset-contract";

import { stableStringify } from "../rules/dataset-version.rules.ts";

/** The streaming SHA-256 over a dataset's columns, then its rows in order. */
export class DatasetContentHasherService {
  readonly #hash: Hash = createHash("sha256");
  #rows = 0;
  #bytes = 0;

  static create({ columns }: { columns: DatasetColumns }): DatasetContentHasherService {
    return new DatasetContentHasherService(columns);
  }

  private constructor(columns: DatasetColumns) {
    this.#hash.update(`columns:${stableStringify(columns)}\n`);
  }

  push(row: DatasetVersionRow): void {
    const line = stableStringify({ id: row.id, entry: row.entry });
    this.#hash.update(`${line}\n`);
    this.#rows += 1;
    this.#bytes += Buffer.byteLength(line, "utf8") + 1;
  }

  digest(): { contentHash: string; rowCount: number; sizeBytes: number } {
    return { contentHash: this.#hash.digest("hex"), rowCount: this.#rows, sizeBytes: this.#bytes };
  }
}
