/**
 * @vitest-environment node
 * An uploaded file read row by row, held to the limits it is given.
 */
import { describe, expect, it } from "vitest";

import { DatasetFileReaderService, type DatasetFileRow } from "../dataset-file-reader.service.ts";

const MIB = 1024 * 1024;

/** The file as it arrives over the network: in pieces, counting how many were taken. */
function pieces(content: string, pieceBytes = 64 * 1024) {
  const whole = Buffer.from(content, "utf8");
  let taken = 0;
  async function* body(): AsyncGenerator<Uint8Array> {
    for (let at = 0; at < whole.byteLength; at += pieceBytes) {
      taken += Math.min(pieceBytes, whole.byteLength - at);
      yield whole.subarray(at, at + pieceBytes);
    }
  }

  return { body: body(), taken: () => taken, size: whole.byteLength };
}

async function rowsOf(
  reader: DatasetFileReaderService,
  input: Parameters<DatasetFileReaderService["rows"]>[0],
): Promise<DatasetFileRow[]> {
  const rows: DatasetFileRow[] = [];
  for await (const row of reader.rows(input)) rows.push(row);

  return rows;
}

const reader = (limits: { rowBytes?: number; jsonFileBytes?: number; fileBytes?: number } = {}) =>
  DatasetFileReaderService.create({
    rowBytes: limits.rowBytes ?? 64 * MIB,
    jsonFileBytes: limits.jsonFileBytes ?? 64 * MIB,
    fileBytes: limits.fileBytes,
  });

describe("DatasetFileReaderService", () => {
  describe("given a JSONL file", () => {
    describe("when one line holds 9 MB", () => {
      /** @scenario "An uploaded file with a row of several megabytes is accepted" */
      it("reads the line whole, with the lines around it", async () => {
        const wide = "x".repeat(9 * MIB);
        const file = pieces(`{"a":"first"}\n{"a":"${wide}"}\r\n\n{"a":"last"}`);

        const rows = await rowsOf(reader(), { bytes: file.body, format: "jsonl" });

        expect(rows.map((row) => String(row.record.a).length)).toEqual([5, 9 * MIB, 4]);
      });
    });

    describe("when one line is larger than the row limit", () => {
      /** @scenario "An uploaded row larger than the row limit is refused naming the limit" */
      it("refuses at the limit, without reading the file to its end", async () => {
        const file = pieces(`{"a":"ok"}\n{"a":"${"x".repeat(4 * MIB)}"}\n`);

        await expect(
          rowsOf(reader({ rowBytes: MIB }), { bytes: file.body, format: "jsonl" }),
        ).rejects.toMatchObject({
          code: "dataset_row_too_large",
          httpStatus: 413,
          meta: { maxBytes: MIB, measure: "uploaded" },
        });
        expect(file.taken()).toBeLessThan(2 * MIB);
      });
    });

    describe("when the file opens with an array", () => {
      it("reads every object of the array", async () => {
        const file = pieces('[\n{"a":1},\n{"a":2}\n]\n');

        const rows = await rowsOf(reader(), { bytes: file.body, format: "jsonl" });

        expect(rows.map((row) => row.record)).toEqual([{ a: 1 }, { a: 2 }]);
      });
    });
  });

  describe("given a CSV file", () => {
    describe("when one row holds 9 MB", () => {
      /** @scenario "An uploaded file with a row of several megabytes is accepted" */
      it("reads the row whole, after the header row", async () => {
        const wide = "x".repeat(9 * MIB);
        const file = pieces(`a,b\n1,${wide}\n2,small\n`);

        const rows = await rowsOf(reader(), { bytes: file.body, format: "csv" });

        expect(rows[0]).toEqual({ headers: ["a", "b"], record: {} });
        expect(rows.slice(1).map((row) => String(row.record.b).length)).toEqual([9 * MIB, 5]);
      });
    });

    describe("when one row is larger than the row limit", () => {
      /** @scenario "An uploaded row larger than the row limit is refused naming the limit" */
      it("refuses the row", async () => {
        const file = pieces(`a,b\n1,${"x".repeat(3 * MIB)}\n`);

        await expect(
          rowsOf(reader({ rowBytes: MIB }), { bytes: file.body, format: "csv" }),
        ).rejects.toMatchObject({ code: "dataset_row_too_large", meta: { maxBytes: MIB } });
      });

      it("refuses a row that never ends, without reading the file to its end", async () => {
        const file = pieces(`a,b\n1,"${"x".repeat(64 * MIB)}`, MIB);

        await expect(
          rowsOf(reader({ rowBytes: MIB }), { bytes: file.body, format: "csv" }),
        ).rejects.toMatchObject({ code: "dataset_row_too_large" });
        expect(file.taken()).toBeLessThan(file.size);
      });
    });
  });

  describe("given a file larger than the upload limit", () => {
    describe("when it is read", () => {
      /** @scenario "An uploaded file larger than the file limit is refused naming the limit" */
      it("refuses once the limit is passed, naming it", async () => {
        const line = `{"a":"${"x".repeat(1000)}"}\n`;
        const file = pieces(line.repeat(4096));

        await expect(
          rowsOf(reader({ fileBytes: MIB }), { bytes: file.body, format: "jsonl" }),
        ).rejects.toMatchObject({
          kind: "file_too_large",
          message: expect.stringContaining("1 MB"),
        });
        expect(file.taken()).toBeLessThan(file.size);
      });
    });
  });

  describe("given a .json array file", () => {
    describe("when its stated size is larger than the .json limit", () => {
      /** @scenario "A .json array larger than its limit is refused and names JSONL" */
      it("refuses before reading a byte, naming JSONL", async () => {
        const file = pieces("[]");

        await expect(
          rowsOf(reader({ jsonFileBytes: MIB }), {
            bytes: file.body,
            format: "json",
            sizeBytes: 2 * MIB,
          }),
        ).rejects.toMatchObject({
          kind: "file_too_large",
          message: expect.stringContaining("JSONL"),
        });
        expect(file.taken()).toBe(0);
      });
    });

    describe("when its bytes pass the .json limit with no size stated", () => {
      /** @scenario "A .json array larger than its limit is refused and names JSONL" */
      it("refuses as the bytes arrive", async () => {
        const file = pieces(JSON.stringify([{ a: "x".repeat(3 * MIB) }]));

        await expect(
          rowsOf(reader({ jsonFileBytes: MIB }), { bytes: file.body, format: "json" }),
        ).rejects.toMatchObject({ kind: "file_too_large" });
        expect(file.taken()).toBeLessThan(file.size);
      });
    });

    describe("when it is not valid JSON", () => {
      it("refuses it as an unsupported format", async () => {
        const file = pieces("[{");

        await expect(
          rowsOf(reader(), { bytes: file.body, format: "json" }),
        ).rejects.toMatchObject({ kind: "unsupported_format" });
      });
    });
  });
});
