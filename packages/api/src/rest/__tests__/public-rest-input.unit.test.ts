import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parsePublicRestInput } from "../public-rest-input.js";

describe("public REST input parsing", () => {
  it("keeps repeated GET query values as arrays while preserving scalar query values", async () => {
    const input = z.object({
      query: z.string(),
      tag: z.array(z.string()),
    });
    const app = new Hono().get("/search", async (context) => {
      const parsed = await parsePublicRestInput({
        context,
        maxInputBytes: 1_024,
        method: "get",
        params: void 0,
        schema: input,
      });
      return context.json(parsed);
    });

    const response = await app.request("/search?query=traces&tag=error&tag=llm");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: "traces",
      tag: ["error", "llm"],
    });
  });
});
