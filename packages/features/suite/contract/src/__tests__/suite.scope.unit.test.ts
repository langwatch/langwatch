import { describe, expect, it } from "vitest";
import { CASES_SCOPE, isDynamicScope, parseSuiteScope, suiteScopeSchema } from "../suite.scope";

describe("suite scope", () => {
  it("parses every supported scope", () => {
    expect(parseSuiteScope({ mode: "all" })).toEqual({ mode: "all" });
    expect(parseSuiteScope({ mode: "folders", folderIds: ["suite_1"] })).toEqual({
      mode: "folders",
      folderIds: ["suite_1"],
    });
    expect(parseSuiteScope({ mode: "labels", labels: ["checkout"] })).toEqual({
      mode: "labels",
      labels: ["checkout"],
    });
    expect(parseSuiteScope({ mode: "cases" })).toEqual(CASES_SCOPE);
  });

  it("rejects malformed scopes", () => {
    expect(suiteScopeSchema.safeParse({ mode: "everything" }).success).toBe(false);
    expect(suiteScopeSchema.safeParse({ mode: "folders" }).success).toBe(false);
    expect(suiteScopeSchema.safeParse({ mode: "labels" }).success).toBe(false);
  });

  it("reads legacy and unknown values as a hand-picked case scope", () => {
    expect(parseSuiteScope(null)).toEqual(CASES_SCOPE);
    expect(parseSuiteScope(void 0)).toEqual(CASES_SCOPE);
    expect(parseSuiteScope({ mode: "everything" })).toEqual(CASES_SCOPE);
  });

  it("identifies scopes resolved at run time", () => {
    expect(isDynamicScope({ mode: "all" })).toBe(true);
    expect(isDynamicScope({ mode: "folders", folderIds: [] })).toBe(true);
    expect(isDynamicScope({ mode: "labels", labels: [] })).toBe(true);
    expect(isDynamicScope(CASES_SCOPE)).toBe(false);
  });
});
