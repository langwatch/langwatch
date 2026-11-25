import { describe, expect, it } from "vitest";

import { vendorClickHouseSettings } from "../clickhouse-member.ts";

describe("vendorClickHouseSettings", () => {
  it("parses ISO timestamps best-effort when the deployment names no settings", () => {
    expect(vendorClickHouseSettings(undefined)).toMatchObject({
      date_time_input_format: "best_effort",
    });
  });

  it("leaves the view dedup setting to each insert, so async inserts are not refused", () => {
    expect(vendorClickHouseSettings(undefined)).not.toHaveProperty(
      "deduplicate_blocks_in_dependent_materialized_views",
    );
  });

  it("keeps the deployment's own settings beside it", () => {
    expect(vendorClickHouseSettings({ max_threads: "4" })).toEqual({
      date_time_input_format: "best_effort",
      max_threads: "4",
    });
  });
});
