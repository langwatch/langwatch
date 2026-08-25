import { describe, expect, it } from "vitest";

import { getNodeDisplayName } from "../src/workflow-nodes";

describe("getNodeDisplayName", () => {
  it.each([
    [
      { localConfig: { name: "Local Name" }, name: "DB Name", cls: "SomeClass" },
      "Local Name",
    ],
    [{ name: "Node Name", cls: "SomeClass" }, "Node Name"],
    [{ cls: "SomeClass" }, "SomeClass"],
    [{}, "node-1"],
  ])("uses the established display-name precedence", (data, expected) => {
    expect(getNodeDisplayName({ id: "node-1", data })).toBe(expected);
  });
});
