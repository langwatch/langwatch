import { describe, expect, it } from "vitest";

import { monitorRestCreateInputSchema } from "../monitor-rest.schemas.ts";

const body = { name: "Exact", checkType: "langevals/exact_match" };

describe("monitorRestCreateInputSchema mappings", () => {
  describe("given a mapping sent without expansions", () => {
    /** @scenario "A REST monitor mapping is checked at the door" */
    it("accepts it with no expansions", () => {
      const parsed = monitorRestCreateInputSchema.parse({
        ...body,
        mappings: { mapping: { output: { source: "output" } } },
      });

      expect(parsed.mappings).toEqual({
        mapping: { output: { source: "output" } },
        expansions: [],
      });
    });
  });

  describe("given a legacy empty object", () => {
    /** @scenario "A REST monitor mapping is checked at the door" */
    it("reads it as an empty mapping", () => {
      expect(monitorRestCreateInputSchema.parse({ ...body, mappings: {} }).mappings).toEqual({
        mapping: {},
        expansions: [],
      });
    });
  });

  describe("given a mapping that is not an object of fields", () => {
    /** @scenario "A REST monitor mapping is checked at the door" */
    it("refuses it at the door, naming mappings", () => {
      const result = monitorRestCreateInputSchema.safeParse({
        ...body,
        mappings: { mapping: "output", expansions: [] },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path[0]).toBe("mappings");
    });
  });
});
