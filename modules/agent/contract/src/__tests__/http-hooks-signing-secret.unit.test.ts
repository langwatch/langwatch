import { describe, expect, it } from "vitest";

import { httpAgentConfigSchema } from "../config/http.ts";

const parse = (hooksSigningSecret: string) =>
  httpAgentConfigSchema.safeParse({ url: "https://a.example/chat", hooksSigningSecret });

describe("hooksSigningSecret length", () => {
  it("refuses a typed secret under 16 characters", () => {
    expect(parse("x").success).toBe(false);
  });

  it("accepts a blank one (keeps the stored reference) and a generated one", () => {
    expect(parse("").success).toBe(true);
    expect(parse(`whsec_${"a1".repeat(32)}`).success).toBe(true);
  });
});
