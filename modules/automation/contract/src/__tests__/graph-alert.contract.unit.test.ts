import { describe, expect, it } from "vitest";

import { findGraphAlertFromTriggerRow, graphAlertActionParamsSchema } from "../graph-alert.ts";

describe("graph-alert contract", () => {
  it("validates the portable threshold shape", () => {
    expect(
      graphAlertActionParamsSchema.validate({
        threshold: 2,
        operator: "gte",
        timePeriod: 15,
        seriesName: "0/latency/p95",
      }),
    ).toBe(true);
  });

  it("preserves provider destination keys when reading a row", () => {
    expect(
      findGraphAlertFromTriggerRow({
        threshold: 2,
        operator: "gte",
        timePeriod: 15,
        seriesName: "0/latency/p95",
        slackWebhook: "https://hooks.slack.com/services/test",
      }),
    ).toMatchObject({ slackWebhook: expect.any(String), operator: "gte" });
  });
});
