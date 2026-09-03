import { describe, expect, it } from "vitest";
import { DEFAULT_TRACE_ORIGIN, deriveTraceOrigin } from "../derive-trace-origin";

describe("deriveTraceOrigin", () => {
  it("defaults missing and empty origins to application", () => {
    expect(deriveTraceOrigin(void 0)).toBe(DEFAULT_TRACE_ORIGIN);
    expect(deriveTraceOrigin({})).toBe(DEFAULT_TRACE_ORIGIN);
    expect(deriveTraceOrigin({ "langwatch.origin": "" })).toBe(DEFAULT_TRACE_ORIGIN);
  });

  it("preserves a non-empty origin", () => {
    expect(deriveTraceOrigin({ "langwatch.origin": "evaluation" })).toBe("evaluation");
  });
});
