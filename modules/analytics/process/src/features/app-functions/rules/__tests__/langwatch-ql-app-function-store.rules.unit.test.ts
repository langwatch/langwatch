import { describe, expect, it } from "vitest";

import {
  canProvisionAppFunctions,
  findFunctionStoreCluster,
  findReplicasOffStore,
  findSplitAppFunctions,
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

describe("findFunctionStoreCluster", () => {
  const clusters = [
    { name: "default", hosts: 1, widestShard: 1 },
    { name: "langwatch", hosts: 3, widestShard: 3 },
  ];

  it("takes the named cluster when it spans every replica", () => {
    expect(findFunctionStoreCluster({ named: "langwatch", clusters, maxTotalReplicas: 3 })).toEqual(
      [clusters[1]],
    );
  });

  it("refuses a named cluster narrower than the widest replica set", () => {
    expect(findFunctionStoreCluster({ named: "default", clusters, maxTotalReplicas: 3 })).toEqual(
      [],
    );
  });

  it("finds the one cluster whose widest shard matches the replica count", () => {
    expect(findFunctionStoreCluster({ named: undefined, clusters, maxTotalReplicas: 3 })).toEqual([
      clusters[1],
    ]);
  });

  it("finds none when two clusters match, since either may miss a replica", () => {
    expect(
      findFunctionStoreCluster({
        named: undefined,
        clusters: [...clusters, { name: "other", hosts: 3, widestShard: 3 }],
        maxTotalReplicas: 3,
      }),
    ).toEqual([]);
  });
});

describe("isFunctionStoreInKeeper", () => {
  const store = { storeNodeExists: true };
  const replica = (host: string, names: string[]) => ({
    host,
    functions: Object.fromEntries(names.map((name) => [name, `CREATE FUNCTION ${name}`])),
  });

  it("is not in Keeper when the store node is missing", () => {
    expect(
      isFunctionStoreInKeeper({ storeNodeExists: false, storeEntries: [], replicas: [] }),
    ).toBe(false);
  });

  it("is not in Keeper when no replica answered", () => {
    expect(isFunctionStoreInKeeper({ ...store, storeEntries: [], replicas: [] })).toBe(false);
  });

  it("falls back to the node when the store and every replica hold no function", () => {
    expect(
      isFunctionStoreInKeeper({
        ...store,
        storeEntries: [],
        replicas: [replica("a", []), replica("b", [])],
      }),
    ).toBe(true);
  });

  it("is in Keeper when every replica holds exactly the store's functions", () => {
    expect(
      isFunctionStoreInKeeper({
        ...store,
        storeEntries: ["function_odd%2Ename.sql", "function_llm_readable_thread.sql", "lock"],
        replicas: [
          replica("a", ["llm_readable_thread", "odd.name"]),
          replica("b", ["odd.name", "llm_readable_thread"]),
        ],
      }),
    ).toBe(true);
  });

  it("is not in Keeper when one replica knows a function the store lacks", () => {
    const readings = {
      ...store,
      storeEntries: ["function_x.sql"],
      replicas: [replica("a", ["x"]), replica("b", ["x", "local_only"])],
    };
    expect(isFunctionStoreInKeeper(readings)).toBe(false);
    expect(findReplicasOffStore(readings)).toEqual(["b"]);
  });

  it("is not in Keeper when one replica never loaded a stored function", () => {
    const readings = {
      ...store,
      storeEntries: ["function_x.sql"],
      replicas: [replica("a", ["x"]), replica("b", [])],
    };
    expect(isFunctionStoreInKeeper(readings)).toBe(false);
    expect(findReplicasOffStore(readings)).toEqual(["b"]);
  });
});

describe("isFunctionStoreInKeeper given one name with two definitions", () => {
  /** @scenario "A replicated server whose replicas hold one function with different definitions is not provisionable" */
  it("is not in Keeper, so the next deploy skips the functions rather than retrying the create", () => {
    expect(
      isFunctionStoreInKeeper({
        storeNodeExists: true,
        storeEntries: ["function_same_name.sql"],
        replicas: [
          { host: "a", functions: { same_name: "CREATE FUNCTION same_name AS () -> 1" } },
          { host: "b", functions: { same_name: "CREATE FUNCTION same_name AS () -> 2" } },
        ],
      }),
    ).toBe(false);
  });
});

describe("findSplitAppFunctions", () => {
  const stored = ["function_f.sql"];

  it("finds nothing when Keeper and every replica hold one definition", () => {
    expect(
      findSplitAppFunctions({
        names: ["f"],
        storeEntries: stored,
        replicas: [
          { host: "a", functions: { f: "CREATE FUNCTION f AS () -> 1" } },
          { host: "b", functions: { f: "CREATE FUNCTION f AS () -> 1" } },
        ],
      }),
    ).toEqual([]);
  });

  it("names the hosts a created function is missing from", () => {
    expect(
      findSplitAppFunctions({
        names: ["f"],
        storeEntries: [],
        replicas: [
          { host: "a", functions: { f: "CREATE FUNCTION f AS () -> 1" } },
          { host: "b", functions: {} },
        ],
      }),
    ).toEqual([{ name: "f", missingOn: ["b"], inKeeper: false, oneDefinition: true }]);
  });

  it("catches a replace that reached one replica of several holding the name", () => {
    expect(
      findSplitAppFunctions({
        names: ["f"],
        storeEntries: stored,
        replicas: [
          { host: "a", functions: { f: "CREATE FUNCTION f AS () -> 1" } },
          { host: "b", functions: { f: "CREATE FUNCTION f AS () -> 2" } },
        ],
      }),
    ).toEqual([{ name: "f", missingOn: [], inKeeper: true, oneDefinition: false }]);
  });
});
