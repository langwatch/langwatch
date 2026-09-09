/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { neutralizeFormula } from "@langwatch/csv";
import { csvFileName } from "../../model/annotation-export.ts";

describe("the annotation export formula guard", () => {
  describe("given a cell a spreadsheet would run as a formula", () => {
    describe("when the file is written", () => {
      it("marks the cell as text so it is shown, not executed", () => {
        expect(neutralizeFormula("=1+1")).toBe("'=1+1");
      });

      it("covers every leader a spreadsheet acts on", () => {
        expect(["=cmd", "+cmd", "@cmd"].map(neutralizeFormula)).toEqual([
          "'=cmd",
          "'+cmd",
          "'@cmd",
        ]);
      });

      it("covers the whitespace leaders too", () => {
        expect(["\tcmd", "\rcmd"].map(neutralizeFormula)).toEqual(["'\tcmd", "'\rcmd"]);
      });
    });
  });

  describe("given a column heading a spreadsheet would run as a formula", () => {
    describe("when the file is written", () => {
      it("marks the heading as text so it is shown, not executed", () => {
        // A heading is not always fixed text: a score type column is headed
        // with the name its project gave it, so it is somebody's typing too.
        expect(neutralizeFormula("=cmd|' /c calc'!A1")).toBe("'=cmd|' /c calc'!A1");
      });
    });
  });

  describe("given ordinary content", () => {
    describe("when the file is written", () => {
      it("leaves it exactly as it was written", () => {
        expect(["clear enough", "good (on point)", 4].map(neutralizeFormula)).toEqual([
          "clear enough",
          "good (on point)",
          4,
        ]);
      });

      it("leaves a negative number a number", () => {
        // "-5" opens with a leader but is not a formula, and quoting it would
        // turn a column of numbers into a column of text.
        expect(["-5", "-1.5", ""].map(neutralizeFormula)).toEqual(["-5", "-1.5", ""]);
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
