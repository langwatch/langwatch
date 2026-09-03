import { describe, expect, it } from "vitest";

import { getSuiteSetId, isSuiteSetId, tryExtractSuiteId } from "../suite-set-id";

describe("suite set IDs", () => {
  /** @scenario "Suite run uses suite ID as setId" */
  it("builds the existing internal suite namespace", () => {
    expect(getSuiteSetId("suite_abc123")).toBe("__internal__suite_abc123__suite");
  });

  it("distinguishes suite set IDs from other set IDs", () => {
    expect(isSuiteSetId("__internal__suite_abc123__suite")).toBe(true);
    expect(isSuiteSetId("__internal__proj_1__on-platform-scenarios")).toBe(false);
    expect(isSuiteSetId("my-custom-set")).toBe(false);
  });

  it("extracts only suite IDs", () => {
    expect(tryExtractSuiteId("__internal__suite_abc123__suite")).toBe("suite_abc123");
    expect(tryExtractSuiteId("__internal__proj_1__on-platform-scenarios")).toBe(null);
    expect(tryExtractSuiteId("my-custom-set")).toBe(null);
  });
});
