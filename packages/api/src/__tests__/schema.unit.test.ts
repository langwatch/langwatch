import { describe, expect, it } from "vitest";
import { z as z4 } from "zod";
import { z as z3 } from "zod/v3";
import { parseApiSchemaSync } from "../schema.js";

describe("API Standard Schema boundary", () => {
  it("parses Zod 4 schemas and preserves transformed output", () => {
    const result = parseApiSchemaSync(
      z4.object({ count: z4.coerce.number() }),
      { count: "4" },
    );

    expect(result).toEqual({ success: true, data: { count: 4 } });
  });

  it("keeps existing Zod 3 routes compatible during app migration", () => {
    const result = parseApiSchemaSync(z3.object({ name: z3.string().trim() }), {
      name: " legacy ",
    });

    expect(result).toEqual({ success: true, data: { name: "legacy" } });
  });
});
