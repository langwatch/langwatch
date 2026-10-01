import { describe, expect, it } from "vitest";

import { supplyToken } from "../src/index.ts";

/** A supply token names a process-provided dependency, so its name is any string, never a module name. */
describe("given a supply token outside the module namespace", () => {
  it("accepts a name no module owns", () => {
    const token = supplyToken<{ read: () => string }>()("licenseSource");
    const name: "licenseSource" = token.name;
    expect(name).toBe("licenseSource");
  });

  it("refuses an empty name", () => {
    expect(() => supplyToken<{ read: () => string }>()("")).toThrow(TypeError);
  });
});
