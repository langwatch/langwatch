/**
 * What a schema refusal reports when Ajv refuses without saying why.
 *
 * `validateAgainstVegaLiteSchema` returns a list of errors, and every caller
 * reads an empty list as "the schema accepted this". Ajv is allowed to return
 * `false` with `errors` left null or empty, and the reducer that picks the most
 * specific errors takes `Math.max` over that pool — `-Infinity`, which nothing
 * matches. So the refusal path can produce exactly the value the accept path
 * produces, and an invalid specification is admitted.
 *
 * The corpus suites cannot reach this: every fixture they refuse comes back
 * with errors attached, which is the branch that already worked. The validator
 * is stubbed here because the state under test is one the real generated
 * validator does not produce on demand.
 *
 * @see ../../src/visualization/vega-lite-schema.ts — the function under test
 * @see ./vega-liteSchemavalidator.unit.test.ts — the real validator's fidelity
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Set per-case, then read by the stubbed validator below. */
let stubbedErrors: unknown;

vi.mock("../vega-lite-schema-validator.generated.js", () => {
  // Always a refusal: this file is only about what a refusal reports.
  const validate = () => false;
  // `defineProperty`, not `Object.assign`: assign reads a source getter once
  // and copies the value it returned, which would pin `errors` to whatever it
  // held at module load and make every case below identical.
  Object.defineProperty(validate, "errors", {
    get: () => stubbedErrors,
    configurable: true,
  });
  return { default: validate };
});

const { validateAgainstVegaLiteSchema } =
  await import("../vega-lite-schema");

describe("given a specification the schema refuses", () => {
  beforeEach(() => {
    stubbedErrors = undefined;
  });

  describe.each([
    { label: "null", errors: null },
    { label: "an empty array", errors: [] },
    { label: "undefined", errors: undefined },
  ])("when the validator reports $label", ({ errors }) => {
    beforeEach(() => {
      stubbedErrors = errors;
    });

    it("still reports the refusal, rather than an acceptance", () => {
      const reported = validateAgainstVegaLiteSchema({ mark: "bar" });

      // The whole finding in one assertion: an empty list here is what the
      // caller reads as "valid", so a detail-free refusal would admit the spec.
      expect(reported, "a refusal must never be reported as zero errors").not.toEqual([]);
      expect(reported).toHaveLength(1);
    });

    it("names the schema rule, so the refusal is attributable", () => {
      const [first] = validateAgainstVegaLiteSchema({ mark: "bar" });

      expect(first).toMatchObject({ rule: "spec.schema-invalid" });
      expect(first?.message).toBeTruthy();
      // Nothing to point at: Ajv named no instance path, so the refusal is
      // about the document as a whole.
      expect(first?.path).toBe("/");
    });
  });

  describe("when the validator reports the errors it found", () => {
    beforeEach(() => {
      stubbedErrors = [
        {
          instancePath: "/encoding/x/type",
          schemaPath: "#/properties/type/enum",
          keyword: "enum",
          params: {},
          message: "must be equal to one of the allowed values",
        },
      ];
    });

    it("reports those, not the generic fallback", () => {
      const reported = validateAgainstVegaLiteSchema({ mark: "bar" });

      // Both paths carry `spec.schema-invalid` — it is the rule for "the
      // schema refused this" either way — so the rule cannot tell them apart.
      // What separates them is that a real error points at the offending
      // property and carries Ajv's keyword; the fallback can do neither.
      expect(reported).toHaveLength(1);
      expect(reported[0]?.path).toBe("/encoding/x/type");
      expect(reported[0]?.meta).toMatchObject({ keyword: "enum" });
    });
  });
});
