import { describe, expect, it } from "vitest";
import {
  personalUsageQueryInputSchema,
  personalUsageSummarySchema,
} from "../personal-usage";

describe("personal usage contract", () => {
  it("accepts a portable epoch-millisecond window", () => {
    expect(
      personalUsageQueryInputSchema.parse({
        personalProjectId: "project",
        window: { startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 },
      }),
    ).toEqual({
      personalProjectId: "project",
      window: { startMs: 1_700_000_000_000, endMs: 1_700_086_400_000 },
    });
  });

  it("rejects inverted windows and malformed output", () => {
    expect(
      personalUsageQueryInputSchema.safeParse({
        personalProjectId: "project",
        window: { startMs: 20, endMs: 10 },
      }).success,
    ).toBe(false);
    expect(
      personalUsageSummarySchema.safeParse({
        spentUsd: 1,
        billedUsd: 1,
        requests: -1,
        promptTokens: 0,
        completionTokens: 0,
        mostUsedModel: null,
      }).success,
    ).toBe(false);
  });
});
