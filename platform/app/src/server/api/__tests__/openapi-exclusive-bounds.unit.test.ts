/**
 * The 3.1 spelling of an exclusive bound, and that the published document
 * carries no 3.0 leftovers.
 *
 * @see specs/api-reference/exclusive-bounds-3-1.feature
 */
import { describe, expect, it } from "vitest";
import spec from "../../../app/api/openapiLangWatch.json";
import { normalizeExclusiveBounds } from "../openapi-exclusive-bounds";

describe("normalizeExclusiveBounds", () => {
  describe("given a lower bound written the 3.0 way", () => {
    /** @scenario "A boolean exclusive bound is rewritten as the number it meant" */
    it("rewrites the flag as the number it meant and drops the inclusive bound", () => {
      const schema = {
        type: "integer",
        minimum: 0,
        exclusiveMinimum: true,
        maximum: 1000,
      };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({
        type: "integer",
        exclusiveMinimum: 0,
        maximum: 1000,
      });
    });
  });

  describe("given an upper bound written the 3.0 way", () => {
    /** @scenario "The same holds for an upper bound" */
    it("rewrites the flag as the number it meant", () => {
      const schema = { type: "number", maximum: 100, exclusiveMaximum: true };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({ type: "number", exclusiveMaximum: 100 });
    });
  });

  describe("given an inclusive bound", () => {
    /** @scenario "An inclusive bound is left as it was" */
    it("keeps the bound and drops the flag that said nothing", () => {
      const schema = { type: "integer", minimum: 0, exclusiveMinimum: false };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({ type: "integer", minimum: 0 });
    });
  });

  describe("given a flag with no bound beside it", () => {
    /** @scenario "A flag with no bound beside it is dropped" */
    it("drops the flag", () => {
      const schema = { type: "integer", exclusiveMinimum: true };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({ type: "integer" });
    });
  });

  describe("given a document with the bounds nested in arrays and objects", () => {
    it("walks the whole document", () => {
      const document = {
        components: {
          schemas: {
            page: {
              anyOf: [{ type: "integer", minimum: 0, exclusiveMinimum: true }],
            },
          },
        },
      };

      normalizeExclusiveBounds(document);

      expect(document.components.schemas.page.anyOf[0]).toEqual({
        type: "integer",
        exclusiveMinimum: 0,
      });
    });
  });
});

describe("the published OpenAPI document", () => {
  /** @scenario "The published document carries no boolean exclusive bound" */
  it("spells every exclusive bound as a number", () => {
    const booleanBounds: string[] = [];

    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, index) => walk(child, `${path}[${index}]`));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (
          (key === "exclusiveMinimum" || key === "exclusiveMaximum") &&
          typeof value === "boolean"
        ) {
          booleanBounds.push(`${path}.${key}`);
        }
        walk(value, `${path}.${key}`);
      }
    };

    walk(spec, "$");

    expect(booleanBounds).toEqual([]);
  });
});
