/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { downloadCsv } from "@langwatch/csv/download";

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

  it("keeps quoted, multiline, and Unicode annotation text intact", async () => {
    const file = await writtenFile({
      fields: ["Comment", "Reviewer"],
      rows: [[`said "yes", then\nleft`, "🦊"]],
    });

    expect(file).toBe('Comment,Reviewer\r\n"said ""yes"", then\nleft",🦊');
  });
});
