/**
 * Unit tests for suite fields: what a suite may declare, and how a typed value
 * is read off a scenario.
 *
 * @see specs/scenarios/scenario-fields.feature
 */

import { describe, expect, it } from "vitest";

import {
  coerceFieldValue,
  fieldValueIsBlank,
  fieldValueMatchesType,
  parseScenarioFieldValues,
  parseSuiteFieldDefinitions,
  suiteFieldDefinitionsSchema,
} from "../suite-fields";

describe("suite fields", () => {
  describe("given a suite declaring fields", () => {
    describe("when the identifiers follow the grammar", () => {
      it("accepts the declaration", () => {
        const result = suiteFieldDefinitionsSchema.safeParse([
          { identifier: "golden_sql", type: "text" },
          { identifier: "max_rows2", type: "number" },
        ]);
        expect(result.success).toBe(true);
      });
    });

    describe("when an identifier has spaces or capitals", () => {
      it("refuses the declaration", () => {
        const result = suiteFieldDefinitionsSchema.safeParse([
          { identifier: "Golden SQL", type: "text" },
        ]);
        expect(result.success).toBe(false);
      });
    });

    describe("when an identifier is a name the scenario already answers to", () => {
      it("refuses the declaration", () => {
        for (const identifier of ["situation", "criteria", "name"]) {
          const result = suiteFieldDefinitionsSchema.safeParse([
            { identifier, type: "text" },
          ]);
          expect(result.success).toBe(false);
        }
      });
    });

    describe("when two fields share an identifier", () => {
      it("refuses the declaration at the second field", () => {
        const result = suiteFieldDefinitionsSchema.safeParse([
          { identifier: "golden_sql", type: "text" },
          { identifier: "golden_sql", type: "number" },
        ]);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.path).toEqual([1, "identifier"]);
        }
      });
    });

    describe("when a stored column holds a bad shape", () => {
      it("reads as no fields", () => {
        expect(parseSuiteFieldDefinitions(null)).toEqual([]);
        expect(parseSuiteFieldDefinitions("nope")).toEqual([]);
        expect(
          parseSuiteFieldDefinitions([{ identifier: "ok", type: "text" }]),
        ).toEqual([{ identifier: "ok", type: "text" }]);
      });
    });
  });

  describe("given a scenario carrying a value for a typed field", () => {
    describe("when the field is a number and the value is numeric text", () => {
      /** @scenario "A typed value is read in the field's own type" */
      it("reads the number", () => {
        expect(
          coerceFieldValue({ definition: { type: "number" }, raw: "12" }),
        ).toBe(12);
        expect(
          coerceFieldValue({ definition: { type: "number" }, raw: " 1.5 " }),
        ).toBe(1.5);
        expect(
          coerceFieldValue({ definition: { type: "number" }, raw: 3 }),
        ).toBe(3);
      });
    });

    describe("when the field is a boolean and the value is a word", () => {
      it("reads true and false", () => {
        expect(
          coerceFieldValue({ definition: { type: "boolean" }, raw: "yes" }),
        ).toBe(true);
        expect(
          coerceFieldValue({ definition: { type: "boolean" }, raw: "False" }),
        ).toBe(false);
        expect(
          coerceFieldValue({ definition: { type: "boolean" }, raw: true }),
        ).toBe(true);
      });
    });

    describe("when the field is text and the value is a scalar", () => {
      it("reads the text", () => {
        expect(
          coerceFieldValue({ definition: { type: "text" }, raw: "SELECT 1" }),
        ).toBe("SELECT 1");
        expect(coerceFieldValue({ definition: { type: "text" }, raw: 7 })).toBe(
          "7",
        );
      });
    });

    describe("when the value is blank", () => {
      it("reads as no value", () => {
        expect(
          coerceFieldValue({ definition: { type: "text" }, raw: "" }),
        ).toBeUndefined();
        expect(
          coerceFieldValue({ definition: { type: "number" }, raw: "   " }),
        ).toBeUndefined();
        expect(
          coerceFieldValue({ definition: { type: "boolean" }, raw: null }),
        ).toBeUndefined();
        expect(fieldValueIsBlank("")).toBe(true);
        expect(fieldValueIsBlank(" ")).toBe(true);
        expect(fieldValueIsBlank(0)).toBe(false);
        expect(fieldValueIsBlank(false)).toBe(false);
      });
    });

    describe("when the value cannot be read as the field's type", () => {
      /** @scenario "A value that cannot be read as the field's type is no value" */
      it("reads as no value", () => {
        expect(
          coerceFieldValue({ definition: { type: "number" }, raw: "twelve" }),
        ).toBeUndefined();
        expect(
          coerceFieldValue({ definition: { type: "boolean" }, raw: "maybe" }),
        ).toBeUndefined();
        expect(
          coerceFieldValue({ definition: { type: "text" }, raw: { a: 1 } }),
        ).toBeUndefined();
      });
    });

    describe("when a stored value is checked against its type", () => {
      it("matches only the field's own type", () => {
        expect(
          fieldValueMatchesType({ definition: { type: "number" }, value: 1 }),
        ).toBe(true);
        expect(
          fieldValueMatchesType({ definition: { type: "number" }, value: "1" }),
        ).toBe(false);
        expect(
          fieldValueMatchesType({
            definition: { type: "boolean" },
            value: true,
          }),
        ).toBe(true);
        expect(
          fieldValueMatchesType({ definition: { type: "text" }, value: "x" }),
        ).toBe(true);
      });
    });

    describe("when a stored column holds a bad shape", () => {
      it("reads as no values", () => {
        expect(parseScenarioFieldValues(null)).toEqual({});
        expect(parseScenarioFieldValues([1])).toEqual({});
        expect(parseScenarioFieldValues({ golden_sql: "SELECT 1" })).toEqual({
          golden_sql: "SELECT 1",
        });
      });
    });
  });
});
