import { describe, expect, it } from "vitest";

import {
  canProvisionAppFunctions,
  needsKeeperFunctionStore,
} from "../langwatch-ql-app-function-store.rules.ts";

describe("canProvisionAppFunctions", () => {
  it("provisions on a single node, where the local store is the only store", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 1, functionStoreInKeeper: false })).toBe(
      true,
    );
  });

  it("provisions on a plain server with no replicated table", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 0, functionStoreInKeeper: false })).toBe(
      true,
    );
  });

  it("refuses a replicated server whose functions would reach one replica", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 3, functionStoreInKeeper: false })).toBe(
      false,
    );
  });

  it("provisions a replicated server that keeps its functions in Keeper", () => {
    expect(canProvisionAppFunctions({ maxTotalReplicas: 3, functionStoreInKeeper: true })).toBe(
      true,
    );
  });
});

describe("needsKeeperFunctionStore", () => {
  it("asks Keeper only where more than one replica would need the functions", () => {
    expect([0, 1, 2].map(needsKeeperFunctionStore)).toEqual([false, false, true]);
  });
});
