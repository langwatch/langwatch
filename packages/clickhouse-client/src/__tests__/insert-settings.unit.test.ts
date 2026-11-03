import { describe, expect, it } from "vitest";

import { insertSettings } from "../routingDriver.ts";

describe("insertSettings", () => {
  it("leaves an insert that names no async setting alone, since a server profile may make it async", () => {
    expect(insertSettings(undefined)).toEqual({});
    expect(insertSettings({ max_insert_threads: 2 })).toEqual({ max_insert_threads: 2 });
  });

  it("keeps id-index view blocks with an explicitly synchronous insert's dedup", () => {
    expect(insertSettings({ async_insert: 0, wait_for_async_insert: 0 })).toEqual({
      deduplicate_blocks_in_dependent_materialized_views: 1,
      async_insert: 0,
      wait_for_async_insert: 0,
    });
  });

  it("leaves the view dedup setting off an async insert, which ClickHouse would refuse", () => {
    expect(insertSettings({ async_insert: 1, wait_for_async_insert: 1 })).toEqual({
      async_insert: 1,
      wait_for_async_insert: 1,
    });
    expect(insertSettings({ async_insert: "1" })).toEqual({ async_insert: "1" });
  });
});
