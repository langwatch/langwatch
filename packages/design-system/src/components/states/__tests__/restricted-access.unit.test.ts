import { describe, expect, it } from "vitest";

import { describePermission } from "../restricted-access.tsx";

describe("describePermission", () => {
  it("reads a resource:action permission as plain words", () => {
    expect(describePermission("datasets:view")).toBe("view datasets");
    expect(describePermission("model-providers:manage")).toBe("manage model providers");
  });

  it("keeps a permission without an action readable", () => {
    expect(describePermission("ops")).toBe("ops");
  });
});
