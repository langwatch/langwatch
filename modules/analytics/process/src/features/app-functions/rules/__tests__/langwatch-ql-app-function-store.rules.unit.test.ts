import { describe, expect, it } from "vitest";

import {
  canProvisionAppFunctions,
  isFunctionStoreInKeeper,
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

describe("isFunctionStoreInKeeper", () => {
  const store = { storeNodeExists: true };

  it("is not in Keeper when the store node is missing", () => {
    expect(
      isFunctionStoreInKeeper({ storeNodeExists: false, serverFunctions: [], storeEntries: [] }),
    ).toBe(false);
  });

  it("falls back to the node when the store and this server hold no function", () => {
    expect(isFunctionStoreInKeeper({ ...store, serverFunctions: [], storeEntries: [] })).toBe(true);
  });

  it("is in Keeper when the store holds exactly the functions this server knows", () => {
    expect(
      isFunctionStoreInKeeper({
        ...store,
        serverFunctions: ["llm_readable_thread", "odd.name"],
        storeEntries: ["function_odd%2Ename.sql", "function_llm_readable_thread.sql"],
      }),
    ).toBe(true);
  });

  it("is not in Keeper when this server knows a function the store lacks", () => {
    expect(
      isFunctionStoreInKeeper({
        ...store,
        serverFunctions: ["local_only"],
        storeEntries: [],
      }),
    ).toBe(false);
  });

  it("is not in Keeper when the store holds a function this server never loaded", () => {
    expect(
      isFunctionStoreInKeeper({
        ...store,
        serverFunctions: [],
        storeEntries: ["function_x.sql"],
      }),
    ).toBe(false);
  });

  it("ignores store children that are not function entries", () => {
    expect(
      isFunctionStoreInKeeper({
        ...store,
        serverFunctions: ["x"],
        storeEntries: ["function_x.sql", "lock"],
      }),
    ).toBe(true);
  });
});
