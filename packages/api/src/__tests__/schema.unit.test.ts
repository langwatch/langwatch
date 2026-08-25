import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseApiSchemaSync } from "../schema.js";

describe("API Standard Schema boundary", () => {
  it("parses Zod 4 schemas and preserves transformed output", () => {
    const result = parseApiSchemaSync(z.object({ count: z.coerce.number() }), {
      count: "4",
    });

    expect(result).toEqual({ success: true, data: { count: 4 } });
  });
});
