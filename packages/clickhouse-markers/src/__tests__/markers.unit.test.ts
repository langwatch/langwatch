import { describe, expect, it } from "vitest";

import { tenantScope, tenantScopeWithConditions, tenantSet } from "../index.ts";

describe("tenant markers", () => {
  it("writes the windowed marker naming its time column", () => {
    expect(tenantScope("OccurredAt")).toBe("{{tenantScope:OccurredAt}}");
  });

  it("writes the set-only marker", () => {
    expect(tenantSet()).toBe("{{tenantSet}}");
  });

  it("writes the conditions marker for a span read's outer select", () => {
    expect(tenantScopeWithConditions("StartTime")).toBe("{{tenantScopeWithConditions:StartTime}}");
  });
});
