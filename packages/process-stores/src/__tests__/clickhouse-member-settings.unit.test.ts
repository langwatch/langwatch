import { describe, expect, it } from "vitest";

import { vendorClickHouseSettings } from "../clickhouse-member.ts";

describe("vendorClickHouseSettings", () => {
  it("parses ISO timestamps best-effort when the deployment names no settings", () => {
    expect(vendorClickHouseSettings(undefined)).toMatchObject({
      date_time_input_format: "best_effort",
    });
  });

  it("keeps a retried insert's materialised-view blocks, so id indexes survive insert dedup", () => {
    expect(vendorClickHouseSettings(undefined)).toMatchObject({
      deduplicate_blocks_in_dependent_materialized_views: 1,
    });
  });

  it("keeps the deployment's own settings beside it", () => {
    expect(vendorClickHouseSettings({ max_threads: "4" })).toEqual({
      date_time_input_format: "best_effort",
      deduplicate_blocks_in_dependent_materialized_views: 1,
      max_threads: "4",
    });
  });
});
