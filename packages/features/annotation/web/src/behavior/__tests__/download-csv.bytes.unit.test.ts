/**
 * @vitest-environment jsdom
 *
 * The sibling suite mocks papaparse, so it can only show what downloadCsv
 * hands the writer. That is one step short of the thing being promised: what
 * matters is the text that lands in the file somebody opens.
 *
 * This file runs the real writer and reads the bytes back, so the guarantee is
 * held by the artifact rather than by an argument.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { downloadCsv } from "../download-csv";

let lastBlob: Blob | undefined;

beforeAll(() => {
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return "blob:test";
  });
  window.URL.revokeObjectURL = vi.fn();
});

/** The text actually written to the file, read back out of the blob. */
const writtenFile = async (args: { fields: string[]; rows: (string | number)[][] }) => {
  lastBlob = undefined;
  downloadCsv({ ...args, fileName: "f.csv" });
  return await lastBlob!.text();
};

describe("the file downloadCsv actually writes", () => {
  describe("given a heading and a cell a spreadsheet would run", () => {
    it("shows them as text and leaves a number a number", async () => {
      const file = await writtenFile({
        fields: ["Trace ID", "=cmd|' /c calc'!A1", "-5", "@handle"],
        rows: [["ok", "=1+1", "-5", "plain"]],
      });

      expect(file.split("\r\n")).toEqual([
        "Trace ID,'=cmd|' /c calc'!A1,-5,'@handle",
        "ok,'=1+1,-5,plain",
      ]);
    });
  });
});
