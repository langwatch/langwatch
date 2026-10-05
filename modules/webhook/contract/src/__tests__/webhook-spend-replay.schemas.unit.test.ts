/**
 * What the spend replay accepts and refuses at the door, before any service runs.
 * @see specs/ai-gateway/billing-spend-events.feature
 */
import { describe, expect, it } from "vitest";

import { webhookSpendReplayBodySchema } from "../webhook-spend-replay.schemas.ts";

describe("a replay window", () => {
  it("is refused when inverted, as is a window past seven days", () => {
    const base = { endpoint_id: "we_1" };

    expect(webhookSpendReplayBodySchema.validate({ ...base, from: 2000, to: 1000 })).toBe(false);
    expect(
      webhookSpendReplayBodySchema.validate({ ...base, from: 1000, to: 1000 + 8 * 86_400_000 }),
    ).toBe(false);
    expect(webhookSpendReplayBodySchema.validate({ ...base, from: 1000, to: 2000 })).toBe(true);
  });
});
