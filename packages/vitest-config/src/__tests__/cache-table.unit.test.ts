import { describe, expect, it } from "vitest";

import { CacheTable } from "../module-loading-cache/cache-table.ts";

describe("CacheTable", () => {
  it("reads back every entry it was built from, and misses the rest", () => {
    const entries = new Map<string, Buffer>();
    for (let i = 0; i < 2_000; i++)
      entries.set(`file:///p/node_modules/m${i}/\0./x${i}`, Buffer.from(`v${i}`));
    entries.set("file:///ünïcode/\0x", Buffer.from("ü"));

    const table = new CacheTable(CacheTable.build(entries));

    for (const [key, value] of entries) expect(table.get(key)).toEqual(value);
    expect(table.get("missing")).toBeUndefined();
    expect(new Map(table.entries()).size).toBe(entries.size);
  });

  /** @scenario "A damaged cache file reads as empty" */
  it("reads a file cut short, or not a cache file, as empty", () => {
    const built = CacheTable.build(new Map([["key", Buffer.from("value")]]));

    expect(new CacheTable(built.subarray(0, built.length - 1)).get("key")).toBeUndefined();
    expect(new CacheTable(Buffer.from("not a cache file at all")).get("key")).toBeUndefined();
    expect(new CacheTable(undefined).size).toBe(0);
  });
});
