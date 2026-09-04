/**
 * @vitest-environment jsdom
 *
 * Every value in an exported CSV was typed by somebody — a comment, a
 * suggestion, the reason given for a score. A spreadsheet runs a cell opening
 * with `=` as a formula, so the export is the last place that can stop one
 * person's text becoming code on another person's machine.
 *
 * jsdom only for the download itself, which needs a document to hang the link
 * on; nothing here renders a component.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const { unparse } = vi.hoisted(() => ({
  unparse: vi.fn((_input: { fields: string[]; data: unknown[][] }) => "csv"),
}));
vi.mock("papaparse", () => ({ default: { unparse } }));

import { csvFileName, downloadCsv } from "../downloadCsv";

// jsdom implements neither, and the file only needs them not to throw.
beforeAll(() => {
  window.URL.createObjectURL = vi.fn(() => "blob:test");
  window.URL.revokeObjectURL = vi.fn();
});

/** The rows papaparse was actually handed, after the sink had its say. */
const exportedRows = (rows: (string | number)[][]) => {
  unparse.mockClear();
  downloadCsv({ fields: ["A"], rows, fileName: "f.csv" });
  return unparse.mock.calls[0]![0].data;
};

/** The header row papaparse was actually handed, after the sink had its say. */
const exportedFields = (fields: string[]) => {
  unparse.mockClear();
  downloadCsv({ fields, rows: [["a"]], fileName: "f.csv" });
  return unparse.mock.calls[0]![0].fields;
};

describe("downloadCsv", () => {
  describe("given a cell a spreadsheet would run as a formula", () => {
    describe("when the file is written", () => {
      it("marks the cell as text so it is shown, not executed", () => {
        expect(exportedRows([["=1+1"]])[0]).toEqual(["'=1+1"]);
      });

      it("covers every leader a spreadsheet acts on", () => {
        expect(
          exportedRows([["=cmd"], ["+cmd"], ["@cmd"], ["\tcmd"], ["\rcmd"]]),
        ).toEqual([["'=cmd"], ["'+cmd"], ["'@cmd"], ["'\tcmd"], ["'\rcmd"]]);
      });
    });
  });

  describe("given a column heading a spreadsheet would run as a formula", () => {
    describe("when the file is written", () => {
      it("marks the heading as text so it is shown, not executed", () => {
        // A heading is not always fixed text: a score type column is headed
        // with the name its project gave it, so it is somebody's typing too.
        expect(exportedFields(["Trace ID", "=cmd|' /c calc'!A1"])).toEqual([
          "Trace ID",
          "'=cmd|' /c calc'!A1",
        ]);
      });
    });
  });

  describe("given ordinary content", () => {
    describe("when the file is written", () => {
      it("leaves it exactly as it was written", () => {
        expect(
          exportedRows([["clear enough", "good (on point)", 4]])[0],
        ).toEqual(["clear enough", "good (on point)", 4]);
      });

      it("leaves a negative number a number", () => {
        // "-5" opens with a leader but is not a formula, and quoting it would
        // turn a column of numbers into a column of text.
        expect(exportedRows([["-5", "-1.5", ""]])[0]).toEqual([
          "-5",
          "-1.5",
          "",
        ]);
      });
    });
  });
});

describe("csvFileName", () => {
  describe("given a name and a day", () => {
    it("dates the file so two exports do not collide", () => {
      expect(csvFileName("Annotations", new Date("2026-08-08T10:00:00Z"))).toBe(
        "Annotations - 2026-08-08.csv",
      );
    });
  });
});
