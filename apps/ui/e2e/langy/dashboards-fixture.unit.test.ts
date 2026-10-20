import { describe, expect, it } from "vitest";

import { reportTargetOf } from "./dashboards-fixture";

describe("reportTargetOf", () => {
  it("names no target when no report key is set", () => {
    expect(reportTargetOf({ LANGY_REPORT_ENDPOINT: "https://reports.test" })).toBeNull();
  });

  it("refuses a report key without an endpoint", () => {
    expect(() => reportTargetOf({ LANGY_REPORT_API_KEY: "sk-lw-x" })).toThrow(
      "LANGY_REPORT_ENDPOINT is required with LANGY_REPORT_API_KEY",
    );
  });

  it("returns the key and endpoint when both are set", () => {
    expect(
      reportTargetOf({ LANGY_REPORT_API_KEY: "sk-lw-x", LANGY_REPORT_ENDPOINT: "https://r.test" }),
    ).toEqual({ apiKey: "sk-lw-x", endpoint: "https://r.test" });
  });
});
