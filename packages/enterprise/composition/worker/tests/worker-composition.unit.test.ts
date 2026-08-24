import { describe, expect, it } from "vitest";
import { EnterpriseWorkerComposition } from "../src";

describe("EnterpriseWorkerComposition", () => {
  it("creates a worker-only shell over the portable catalogue", () => {
    expect(
      EnterpriseWorkerComposition.create().catalogue.get("licensing"),
    ).toBeDefined();
  });
});
