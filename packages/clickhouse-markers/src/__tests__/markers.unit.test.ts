import { describe, expect, it } from "vitest";

import {
  tenantScope,
  tenantScopeForLatestVersion,
  tenantScopeWithConditions,
  tenantSet,
} from "../index.ts";

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

  it("names the parameter that bounds the held-trace semi-join", () => {
    expect(tenantScopeWithConditions("StartTime", { traceId: "traceId" })).toBe(
      "{{tenantScopeWithConditions:StartTime:traceId=traceId}}",
    );
    expect(tenantScopeWithConditions("StartTime", { sinceMs: "since" })).toBe(
      "{{tenantScopeWithConditions:StartTime:sinceMs=since}}",
    );
  });

  it("writes the latest-version election marker", () => {
    expect(tenantScopeForLatestVersion("StartTime")).toBe(
      "{{tenantScopeForLatestVersion:StartTime}}",
    );
  });
});
