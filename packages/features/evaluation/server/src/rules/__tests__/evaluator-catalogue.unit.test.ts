import { describe, expect, it } from "vitest";

import { buildEvaluatorCatalogue, evaluatorSettingsJsonSchema } from "../evaluator-catalogue.rules.ts";

interface CatalogueEntry {
  name: string;
  settings_json_schema: {
    type?: string;
    properties?: Record<string, { type?: string; default?: unknown; description?: string; enum?: unknown[] }>;
  };
}

describe("the built-in evaluator catalogue", () => {
  describe("given an evaluator whose settings carry a default and a description", () => {
    /** @scenario "An evaluator's settings are described field by field" */
    it("names the object's type and every setting, with its default and prose", () => {
      const schema = evaluatorSettingsJsonSchema("azure/content_safety") as CatalogueEntry["settings_json_schema"];

      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
        "categories",
        "output_type",
        "severity_threshold",
      ]);
      expect(schema.properties?.output_type?.default).toBe("FourSeverityLevels");
      expect(schema.properties?.output_type?.description).toEqual(expect.any(String));
    });

    /** @scenario "A setting with a fixed list of choices publishes that list" */
    it("publishes a fixed set of values as an enumeration", () => {
      const schema = evaluatorSettingsJsonSchema("azure/content_safety") as CatalogueEntry["settings_json_schema"];

      expect(schema.properties?.output_type?.type).toBe("string");
      expect(schema.properties?.output_type?.enum).toEqual([
        "FourSeverityLevels",
        "EightSeverityLevels",
      ]);
      expect(schema.properties?.severity_threshold?.enum).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
  });

  describe("given an evaluator with no settings", () => {
    /** @scenario "An evaluator that takes no settings still answers a schema" */
    it("describes an object with no settings", () => {
      const schema = evaluatorSettingsJsonSchema("azure/jailbreak") as CatalogueEntry["settings_json_schema"];

      expect(schema.type).toBe("object");
      expect(schema.properties).toBeUndefined();
    });
  });

  describe("when the whole catalogue is built", () => {
    /** @scenario "The catalogue leaves the documentation examples out" */
    it("lists the shipped evaluators and none of the documentation examples", () => {
      const catalogue = buildEvaluatorCatalogue() as Record<string, CatalogueEntry>;

      expect(Object.keys(catalogue).length).toBeGreaterThan(0);
      expect(Object.keys(catalogue).filter((key) => key.startsWith("example/"))).toEqual([]);
      expect(catalogue["azure/content_safety"]?.settings_json_schema.properties).toBeDefined();
    });
  });
});
