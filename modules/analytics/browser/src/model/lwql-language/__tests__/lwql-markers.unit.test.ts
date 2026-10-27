/** @see modules/analytics/specs/analytics-lwql-editor.feature */
import type { LangWatchQLViolation } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { lwqlMarkersFromViolations } from "../lwql-markers.ts";

const violation = (overrides: Partial<LangWatchQLViolation>): LangWatchQLViolation => ({
  code: "TABLE_NOT_ALLOWED",
  clause: "from",
  message: "The table analytics.virtual_keys is not available to you.",
  hint: "Read a table listed in the schema.",
  ...overrides,
});

describe("lwqlMarkersFromViolations()", () => {
  describe("given a refusal the server positioned", () => {
    describe("when it is mapped", () => {
      /** @scenario "A marker sits where the server reported the refusal" */
      it("keeps the server's sentence, line and column", () => {
        expect(lwqlMarkersFromViolations([violation({ at: { line: 3, column: 14 } })])).toEqual([
          {
            message: "The table analytics.virtual_keys is not available to you.",
            severity: "error",
            line: 3,
            column: 14,
          },
        ]);
      });
    });
  });

  describe("given a refusal with no position", () => {
    describe("when it is mapped", () => {
      it("draws it at the start of the statement", () => {
        expect(lwqlMarkersFromViolations([violation({})])).toMatchObject([{ line: 1, column: 1 }]);
      });
    });
  });

  describe("given no refusals", () => {
    it("draws nothing", () => {
      expect(lwqlMarkersFromViolations([])).toEqual([]);
    });
  });
});
