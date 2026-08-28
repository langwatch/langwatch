import { describe, expect, it } from "vitest";
import { resolveLegacyEventingConfig } from "../config";

describe("legacy Eventing runtime configuration", () => {
  it.each([
    ["absent", void 0, void 0],
    ["empty", "", void 0],
    ["invalid", "not-a-number", void 0],
    ["below the replication floor", "60", 60],
    ["zero", "0", 0],
    ["negative", "-5", -5],
    ["decimal", "600.9", 600],
    ["trailing text", "600seconds", 600],
  ])("preserves legacy parseInt semantics for %s", (_case, raw, expected) => {
    const config = resolveLegacyEventingConfig({
      ...(raw === undefined ? {} : { LANGWATCH_FOLD_CACHE_TTL_SECONDS: raw }),
    });

    expect(config.foldCacheTtlSeconds).toBe(expected);
  });
});
