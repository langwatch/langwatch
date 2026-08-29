import { describe, expect, it } from "vitest";
import { extractGraphAlertFromTriggerRow, graphAlertActionParamsSchema } from "../graph-alert";

describe("graph-alert contract", () => {
  it("validates the portable threshold shape", () => {
    expect(
      graphAlertActionParamsSchema.safeParse({
        threshold: 2,
        operator: "gte",
        timePeriod: 15,
        seriesName: "0/latency/p95",
      }).success,
    ).toBe(true);
  });

  it("preserves provider destination keys when reading a row", () => {
    expect(
      extractGraphAlertFromTriggerRow({
        threshold: 2,
        operator: "gte",
        timePeriod: 15,
        seriesName: "0/latency/p95",
        slackWebhook: "https://hooks.slack.com/services/test",
      }),
    ).toMatchObject({ slackWebhook: expect.any(String), operator: "gte" });
  });
});
