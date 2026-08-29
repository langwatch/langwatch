import { describe, expect, it } from "vitest";
import {
  isValidPullSchedule,
  pulledUsageObservationKey,
  pulledUsageObservedEventDataSchema,
} from "../index";

describe("governance contract", () => {
  it("uses a runnable five-field pull schedule", () => {
    expect(isValidPullSchedule("*/15 * * * *")).toBe(true);
    expect(isValidPullSchedule("0 0 30 2 *")).toBe(false);
    expect(isValidPullSchedule("not cron")).toBe(false);
  });

  it("rejects lossy pulled-usage facts", () => {
    expect(
      pulledUsageObservedEventDataSchema.safeParse({
        itemKey: "bucket",
        restatementKey: "org:day",
        source: "provider",
        ingestionSourceId: "source",
        organizationId: "org",
        teamId: null,
        projectId: null,
        model: "model",
        tokensInput: 1.5,
        tokensOutput: 0,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        costNanoUsd: 1,
        rateVersion: null,
        costBasis: "provider_reported",
        costStatus: "exact",
        occurredAtMs: 1,
        observedAtMs: 2,
      }).success,
    ).toBe(false);
  });

  it("keeps observed time in the restatement observation key", () => {
    const base = {
      itemKey: "bucket",
      restatementKey: "org:day",
      source: "provider",
      ingestionSourceId: "source",
      organizationId: "org",
      teamId: null,
      projectId: null,
      model: "model",
      costNanoUsd: 1,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      rateVersion: null,
      costBasis: "provider_reported" as const,
      costStatus: "exact" as const,
      occurredAtMs: 1,
    };
    expect(pulledUsageObservationKey({ ...base, observedAtMs: 1 })).not.toBe(
      pulledUsageObservationKey({ ...base, observedAtMs: 2 }),
    );
  });
});
