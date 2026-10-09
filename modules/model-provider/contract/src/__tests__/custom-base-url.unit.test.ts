import { describe, expect, it } from "vitest";

import { modelProviders } from "../model-provider-registry.ts";

describe("custom provider credential schema", () => {
  /** @scenario "A malformed custom base URL is refused by name before anything is probed" */
  it("refuses a base URL that is not a URL, naming the field", () => {
    const result = modelProviders.custom!.keysSchema.safeParse({ CUSTOM_BASE_URL: "not a url" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["CUSTOM_BASE_URL"]);
  });

  /** @scenario "A malformed custom base URL is refused by name before anything is probed" */
  it("accepts a full URL and an empty one", () => {
    const { keysSchema } = modelProviders.custom!;

    expect(keysSchema.validate({ CUSTOM_BASE_URL: "https://llm.acme.dev/v1" })).toBe(true);
    expect(keysSchema.validate({ CUSTOM_BASE_URL: "" })).toBe(true);
  });
});
