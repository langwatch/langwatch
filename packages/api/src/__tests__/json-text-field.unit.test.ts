import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { jsonTextField } from "../json-text-field.ts";

const field = z.object({ graph: jsonTextField(z.record(z.string(), z.unknown())) });

describe("jsonTextField", () => {
  describe("given JSON text that the schema accepts", () => {
    /** @scenario "A JSON-text field hands the handler the parsed value" */
    it("hands the handler the parsed value", () => {
      expect(field.parse({ graph: '{"graphType":"line"}' })).toEqual({
        graph: { graphType: "line" },
      });
    });

    /** @scenario "A JSON-text field hands the handler the parsed value" */
    it("keeps the caller's input type a string and the handler's the schema's", () => {
      expectTypeOf<z.input<typeof field>>().toEqualTypeOf<{ graph: string }>();
      expectTypeOf<z.output<typeof field>>().toEqualTypeOf<{ graph: Record<string, unknown> }>();
    });
  });

  describe("given text that is not JSON", () => {
    /** @scenario "A malformed JSON-text field is a 400 schema issue" */
    it("reports a schema issue on the field instead of throwing", () => {
      const result = field.safeParse({ graph: "{not json" });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ code: "custom", path: ["graph"] }),
      ]);
    });
  });

  describe("given JSON the schema refuses", () => {
    /** @scenario "A malformed JSON-text field is a 400 schema issue" */
    it("reports the schema's own issue on the field", () => {
      const result = field.safeParse({ graph: "[1, 2]" });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["graph"]);
    });
  });
});
