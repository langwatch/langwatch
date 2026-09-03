/**
 * The result table's value formatting, at the level where the distinctions are
 * decided rather than drawn.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  describeLangWatchQLValue,
  duplicateLangWatchQLColumnNames,
  LWQL_VALUE_PREVIEW_LIMIT,
  lwqlCellCopyText,
  lwqlCellText,
  readLangWatchQLCell,
} from "../lwql-value-format";

/** Beyond `Number.MAX_SAFE_INTEGER`, and not representable as a double. */
const WIDE_INTEGER = "9007199254740993";
const WIDE_DECIMAL = "12345678901234567890.123456789";

describe("a LangWatchQL result value", () => {
  describe("given the six ways a cell can hold nothing, zero, or a non-finite number", () => {
    describe("when each is formatted", () => {
      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("renders every one of them differently from the others", () => {
        const row = {
          nullValue: null,
          zero: 0,
          emptyString: "",
          notANumber: Number.NaN,
          infinite: Number.POSITIVE_INFINITY,
        };

        const rendered = {
          // The column is in the result, but this row carries no key for it.
          missing: lwqlCellText(readLangWatchQLCell({ row, column: "absentColumn" })),
          null: lwqlCellText(readLangWatchQLCell({ row, column: "nullValue" })),
          zero: lwqlCellText(readLangWatchQLCell({ row, column: "zero" })),
          emptyString: lwqlCellText(readLangWatchQLCell({ row, column: "emptyString" })),
          nan: lwqlCellText(readLangWatchQLCell({ row, column: "notANumber" })),
          infinity: lwqlCellText(readLangWatchQLCell({ row, column: "infinite" })),
        };

        expect(new Set(Object.values(rendered)).size).toBe(6);
        // Named, so a collapse says which two collapsed rather than only that
        // the count moved.
        expect(rendered).toEqual({
          missing: "missing",
          null: "null",
          zero: "0",
          emptyString: '""',
          nan: "NaN",
          infinity: "Infinity",
        });
      });

      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("keeps the kinds apart, not only the words", () => {
        const row = {
          nullValue: null,
          zero: 0,
          emptyString: "",
          notANumber: Number.NaN,
          infinite: Number.POSITIVE_INFINITY,
        };
        const kinds = [
          "absentColumn",
          "nullValue",
          "zero",
          "emptyString",
          "notANumber",
          "infinite",
        ].map((column) => readLangWatchQLCell({ row, column }).kind);

        expect(kinds).toEqual(["missing", "null", "scalar", "emptyString", "nan", "infinity"]);
      });

      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("tells negative infinity from positive infinity", () => {
        expect(lwqlCellText(describeLangWatchQLValue(Number.NEGATIVE_INFINITY))).toBe("-Infinity");
        expect(lwqlCellText(describeLangWatchQLValue(Number.POSITIVE_INFINITY))).toBe("Infinity");
      });

      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("reports a key that is present but undefined the same way as an absent one", () => {
        expect(readLangWatchQLCell({ row: { value: undefined }, column: "value" }).kind).toBe(
          "missing",
        );
      });
    });
  });

  describe("given a 64-bit integer and a high-precision decimal that arrived as digit strings", () => {
    describe("when they are formatted and copied", () => {
      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("shows and copies the exact digits the response carried", () => {
        const integerCell = describeLangWatchQLValue(WIDE_INTEGER);
        const decimalCell = describeLangWatchQLValue(WIDE_DECIMAL);

        expect(lwqlCellText(integerCell)).toBe(WIDE_INTEGER);
        expect(lwqlCellCopyText(integerCell)).toBe(WIDE_INTEGER);
        expect(lwqlCellText(decimalCell)).toBe(WIDE_DECIMAL);
        expect(lwqlCellCopyText(decimalCell)).toBe(WIDE_DECIMAL);
      });

      /**
       * Without this, the assertions above would still pass on a formatter that
       * ran the string through `Number` — on any value that happens to survive
       * the round trip. These two do not, which is what makes the test able to
       * fail.
       *
       * @scenario "Wide integers and decimals keep every digit"
       */
      it("would have lost digits had the value been coerced to a float", () => {
        expect(String(Number(WIDE_INTEGER))).not.toBe(WIDE_INTEGER);
        expect(String(Number(WIDE_DECIMAL))).not.toBe(WIDE_DECIMAL);
      });

      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("leaves an ordinary number readable without grouping separators", () => {
        // `toLocaleString` would make this "1,234,567" — digits the value does
        // not have, in a cell a member may be reading as data.
        expect(lwqlCellText(describeLangWatchQLValue(1234567))).toBe("1234567");
      });
    });
  });

  describe("given a cell holding an array, a map, or a nested object", () => {
    describe("when it is formatted", () => {
      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("previews it as JSON and offers the whole value for copying", () => {
        const value = { latency: [1, 2, 3], tags: { env: "prod" } };
        const cell = describeLangWatchQLValue(value);

        expect(cell.kind).toBe("structured");
        expect(lwqlCellText(cell)).toBe(JSON.stringify(value));
        expect(lwqlCellCopyText(cell)).toBe(JSON.stringify(value));
      });

      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("bounds the preview of a large structure while copying all of it", () => {
        const value = Array.from({ length: 500 }, (_, index) => index);
        const cell = describeLangWatchQLValue(value);

        if (cell.kind !== "structured") throw new Error("expected a structure");
        expect(cell.clipped).toBe(true);
        expect(cell.display.length).toBeLessThanOrEqual(LWQL_VALUE_PREVIEW_LIMIT + 1);
        expect(cell.display.endsWith("…")).toBe(true);
        // The bound is on the display only; the copy is the whole thing.
        expect(cell.copy).toBe(JSON.stringify(value));
        expect(cell.copy.length).toBeGreaterThan(LWQL_VALUE_PREVIEW_LIMIT);
      });

      /** @scenario "Cell formatting is lossless and distinguishes absence" */
      it("bounds a long string the same way and still copies it whole", () => {
        const value = "x".repeat(LWQL_VALUE_PREVIEW_LIMIT + 50);
        const cell = describeLangWatchQLValue(value);

        if (cell.kind !== "scalar") throw new Error("expected a scalar");
        expect(cell.clipped).toBe(true);
        expect(cell.display.length).toBe(LWQL_VALUE_PREVIEW_LIMIT + 1);
        expect(cell.copy).toBe(value);
      });
    });
  });

  describe("given a result whose columns list the same name twice", () => {
    describe("when the duplicates are looked for", () => {
      /** @scenario "Duplicate columns, truncation, statistics, and diagnostics are honest" */
      it("names each repeated column once, in the order it first appeared", () => {
        expect(
          duplicateLangWatchQLColumnNames([
            { name: "total", type: "UInt64" },
            { name: "day", type: "Date" },
            { name: "total", type: "Float64" },
            { name: "day", type: "DateTime" },
            { name: "total", type: "String" },
          ]),
        ).toEqual(["total", "day"]);
      });

      /** @scenario "Duplicate columns, truncation, statistics, and diagnostics are honest" */
      it("finds none when every name is distinct", () => {
        expect(
          duplicateLangWatchQLColumnNames([
            { name: "total", type: "UInt64" },
            { name: "day", type: "Date" },
          ]),
        ).toEqual([]);
      });
    });
  });
  describe("given a structured cell nobody expands", () => {
    describe("when it is formatted", () => {
      it("does not build the indented copy until it is read", () => {
        const value = { nested: { a: [1, 2, 3] } };
        const stringify = vi.spyOn(JSON, "stringify");

        const cell = describeLangWatchQLValue(value);
        if (cell.kind !== "structured") throw new Error("expected a structure");

        // The compact form is what the grid shows; the indented one is not
        // built yet, because nothing has opened this cell.
        const afterFormat = stringify.mock.calls.length;

        const pretty = cell.pretty;
        expect(stringify.mock.calls.length).toBeGreaterThan(afterFormat);
        expect(pretty).toContain("\n");

        // Re-reading an open cell does not pay for it again.
        const afterFirstRead = stringify.mock.calls.length;
        void cell.pretty;
        expect(stringify.mock.calls.length).toBe(afterFirstRead);

        stringify.mockRestore();
      });
    });
  });
});
