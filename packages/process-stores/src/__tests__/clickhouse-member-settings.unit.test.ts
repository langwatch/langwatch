import { describe, expect, it } from "vitest";

import { vendorClickHouseSettings } from "../clickhouse-member.ts";

describe("vendorClickHouseSettings", () => {
  it("parses ISO timestamps best-effort when the deployment names no settings", () => {
    expect(vendorClickHouseSettings(undefined)).toEqual({ date_time_input_format: "best_effort" });
  });

  it("keeps the deployment's own settings beside it", () => {
    expect(vendorClickHouseSettings({ max_threads: "4" })).toEqual({
      date_time_input_format: "best_effort",
      max_threads: "4",
    });
  });
});
