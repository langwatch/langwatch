import { describe, expect, it } from "vitest";

import { canProvisionAppFunctions } from "../langwatch-ql-app-function-store.rules.ts";

describe("canProvisionAppFunctions", () => {
  it("provisions on a single node, where the local store is the only store", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 1, userDefinedZookeeperPath: "" })).toBe(
      true,
    );
  });

  it("provisions on a plain server with no replicated table", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 0, userDefinedZookeeperPath: "" })).toBe(
      true,
    );
  });

  it("refuses a replicated server whose functions would reach one replica", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 3, userDefinedZookeeperPath: " " })).toBe(
      false,
    );
  });

  it("provisions a replicated server that keeps its functions in Keeper", () => {
    expect(
      canProvisionAppFunctions({
        maxTotalReplicas: 3,
        userDefinedZookeeperPath: "/clickhouse/user_defined",
      }),
    ).toBe(true);
  });
});
