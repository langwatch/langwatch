import { describe, expect, it } from "vitest";

import { tenantScope, tenantSet } from "../index.ts";

describe("tenant markers", () => {
  it("writes the windowed marker naming its time column", () => {
    expect(tenantScope("OccurredAt")).toBe("{{tenantScope:OccurredAt}}");
  });

  it("writes the set-only marker", () => {
    expect(tenantSet()).toBe("{{tenantSet}}");
  });
});
