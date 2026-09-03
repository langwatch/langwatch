/**
 * @vitest-environment node
 *
 * Every value in an exported CSV was typed by somebody — a comment, a
 * suggestion, the reason given for a score. A spreadsheet runs a cell opening
 * with `=` as a formula, so the export is the last place that can stop one
 * person's text becoming code on another person's machine.
 *
 * `toCsv` is what this reads, because it is the whole of the file's content:
 * `downloadCsv` adds only the blob and the anchor, which the sibling suite
 * drives under jsdom.
 */
import { describe, expect, it } from "vitest";

import { toCsv } from "../download-csv";
import { csvFileName } from "../../model/annotation-export";

/** The data rows as they land in the file, split back apart. */
const exportedRows = (rows: (string | number)[][]) =>
  toCsv({ fields: ["A"], rows })
    .split("\r\n")
    .slice(1)
    .map((line) => line.split(","));

/** The header row as it lands in the file, split back apart. */
const exportedFields = (fields: string[]) =>
  toCsv({ fields, rows: [["a"]] })
    .split("\r\n")[0]!
    .split(",");

describe("toCsv", () => {
  describe("given a cell a spreadsheet would run as a formula", () => {
    describe("when the file is written", () => {
      it("marks the cell as text so it is shown, not executed", () => {
        expect(exportedRows([["=1+1"]])[0]).toEqual(["'=1+1"]);
      });

      it("covers every leader a spreadsheet acts on", () => {
        expect(exportedRows([["=cmd"], ["+cmd"], ["@cmd"]])).toEqual([
          ["'=cmd"],
          ["'+cmd"],
          ["'@cmd"],
        ]);
      });

      it("covers the whitespace leaders too", () => {
        // A tab or a carriage return leads the same way, and the carriage
        // return is also quoted because RFC 4180 says so.
        expect(toCsv({ fields: ["A"], rows: [["\tcmd"]] })).toBe("A\r\n'\tcmd");
        expect(toCsv({ fields: ["A"], rows: [["\rcmd"]] })).toBe('A\r\n"\'\rcmd"');
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
        expect(exportedRows([["clear enough", "good (on point)", 4]])[0]).toEqual([
          "clear enough",
          "good (on point)",
          "4",
        ]);
      });

      it("leaves a negative number a number", () => {
        // "-5" opens with a leader but is not a formula, and quoting it would
        // turn a column of numbers into a column of text.
        expect(exportedRows([["-5", "-1.5", ""]])[0]).toEqual(["-5", "-1.5", ""]);
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
