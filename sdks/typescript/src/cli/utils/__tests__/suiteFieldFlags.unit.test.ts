/**
 * The `--field` flag: a field definition on the suite commands, a field value
 * on the scenario commands.
 *
 * Spec: specs/features/test-suite-cli.feature, specs/features/scenario-cli.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseScenarioFieldFlags,
  parseSuiteFieldDefinitionFlags,
} from "../suiteFieldFlags";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // suppresses the refusal text during tests
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const printedErrors = (): string =>
  vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .join("\n");

describe("parseSuiteFieldDefinitionFlags", () => {
  describe("given identifier:type pairs", () => {
    /** @scenario "Create a test suite with fields" */
    it("reads them into definitions, in order", () => {
      expect(
        parseSuiteFieldDefinitionFlags({
          pairs: ["golden_sql:text", "row_limit:number", "strict:boolean"],
        }),
      ).toEqual([
        { identifier: "golden_sql", type: "text" },
        { identifier: "row_limit", type: "number" },
        { identifier: "strict", type: "boolean" },
      ]);
    });

    it("answers nothing when the flag was not written", () => {
      expect(parseSuiteFieldDefinitionFlags({ pairs: undefined })).toBeUndefined();
    });
  });

  describe("given a type the platform does not have", () => {
    /** @scenario "A field with a type the platform does not have is refused" */
    it("refuses the flag naming the three types", () => {
      expect(() =>
        parseSuiteFieldDefinitionFlags({ pairs: ["golden_sql:json"] }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("golden_sql:json");
    });
  });

  describe("given a reserved identifier", () => {
    /** @scenario "A field whose identifier is reserved is refused" */
    it("refuses the flag with the reason", () => {
      expect(() =>
        parseSuiteFieldDefinitionFlags({ pairs: ["situation:text"] }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("situation");
    });
  });

  describe("given a pair with no type", () => {
    it("refuses the flag", () => {
      expect(() =>
        parseSuiteFieldDefinitionFlags({ pairs: ["golden_sql"] }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("identifier:type");
    });
  });
});

describe("parseScenarioFieldFlags", () => {
  const definitions = [
    { identifier: "golden_sql", type: "text" as const },
    { identifier: "row_limit", type: "number" as const },
    { identifier: "strict", type: "boolean" as const },
  ];

  describe("given the suite's definitions", () => {
    /** @scenario "Create a scenario with field values coerced by the suite" */
    it("coerces each value by its declared type", () => {
      expect(
        parseScenarioFieldFlags({
          pairs: ["golden_sql=SELECT 1", "row_limit=10", "strict=true"],
          definitions,
        }),
      ).toEqual({ golden_sql: "SELECT 1", row_limit: 10, strict: true });
    });

    it("keeps a numeric-looking text value as text", () => {
      expect(
        parseScenarioFieldFlags({ pairs: ["golden_sql=007"], definitions }),
      ).toEqual({ golden_sql: "007" });
    });

    it("leaves a blank value out, so the field reads as no value", () => {
      expect(
        parseScenarioFieldFlags({ pairs: ["golden_sql="], definitions }),
      ).toEqual({});
    });

    /** @scenario "A field value the suite does not declare is refused" */
    it("refuses a field the suite does not declare, naming the ones it does", () => {
      expect(() =>
        parseScenarioFieldFlags({ pairs: ["golden=SELECT"], definitions }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("golden_sql, row_limit, strict");
    });

    /** @scenario "A field value that does not read as its type is refused" */
    it("refuses a value that does not read as the field's type", () => {
      expect(() =>
        parseScenarioFieldFlags({ pairs: ["row_limit=ten"], definitions }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("row_limit is a number field");
    });
  });

  describe("given no definitions", () => {
    it("reads true, false and a plain number as what they look like", () => {
      expect(
        parseScenarioFieldFlags({
          pairs: ["golden_sql=SELECT 1", "row_limit=10", "strict=false"],
        }),
      ).toEqual({ golden_sql: "SELECT 1", row_limit: 10, strict: false });
    });
  });

  describe("given a pair with no equals sign", () => {
    it("refuses the flag", () => {
      expect(() =>
        parseScenarioFieldFlags({ pairs: ["golden_sql"], definitions }),
      ).toThrow(ProcessExitError);
      expect(printedErrors()).toContain("identifier=value");
    });
  });
});
