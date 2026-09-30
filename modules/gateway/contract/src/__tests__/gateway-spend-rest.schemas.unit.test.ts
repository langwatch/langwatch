/**
 * What the two spend reads accept and refuse at the door, before any service runs.
 * @see specs/ai-gateway/gateway-spend-rest.feature
 */
import { describe, expect, it } from "vitest";

import {
  gatewaySpendEventsQuerySchema,
  gatewaySpendReplayBodySchema,
  gatewaySpendSummariesQuerySchema,
  spendFilterQueryShape,
} from "../gateway-spend-rest.schemas.ts";

const WINDOW = { from: "1000", to: "2000" };
const INVERTED = { from: "2000", to: "1000" };

const summaries = (query: Record<string, string>) =>
  gatewaySpendSummariesQuerySchema.safeParse({ group_by: "model", ...WINDOW, ...query });

describe("an inverted window", () => {
  /** @scenario An inverted window is refused on both reads */
  it("is refused by the rollups and by the events read alike", () => {
    expect(summaries(INVERTED).success).toBe(false);
    expect(gatewaySpendEventsQuerySchema.validate(INVERTED)).toBe(false);
    expect(gatewaySpendEventsQuerySchema.validate(WINDOW)).toBe(true);
  });

  it("is refused by a replay, as is a window past seven days", () => {
    const base = { endpoint_id: "we_1" };

    expect(gatewaySpendReplayBodySchema.validate({ ...base, from: 2000, to: 1000 })).toBe(false);
    expect(
      gatewaySpendReplayBodySchema.validate({ ...base, from: 1000, to: 1000 + 8 * 86_400_000 }),
    ).toBe(false);
  });
});

describe("the filters of the two reads", () => {
  /** @scenario A filter offered on one read is offered on the other */
  it("are one vocabulary, spread into both", () => {
    const filters = Object.keys(spendFilterQueryShape);
    const eventsKeys = Object.keys(gatewaySpendEventsQuerySchema.shape);
    const summariesKeys = Object.keys(gatewaySpendSummariesQuerySchema.shape);

    for (const filter of filters) {
      expect(eventsKeys).toContain(filter);
      expect(summariesKeys).toContain(filter);
    }
  });
});

describe("the in-flight status", () => {
  /** @scenario The rollups refuse a status they can only answer with zero */
  it("is served by the events read and refused by the rollups, naming the status field", () => {
    expect(gatewaySpendEventsQuerySchema.validate({ ...WINDOW, status: "admitted" })).toBe(true);

    const refused = summaries({ status: "admitted" });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.some((issue) => issue.path.includes("status"))).toBe(true);
    expect(summaries({ status: "confirmed" }).success).toBe(true);
  });
});

describe("the unstable-read opt-out", () => {
  const allowUnstable = (value: string) => {
    const parsed = summaries({ allow_unstable: value });
    return parsed.success ? parsed.data.allow_unstable : parsed.error;
  };

  /** @scenario Declining an unstable read is not the same as accepting one */
  it("reads an explicit false as declining, not as a non-empty string", () => {
    expect(allowUnstable("false")).toBe(false);
    expect(allowUnstable("0")).toBe(false);
  });

  /** @scenario The opt-out is read however the caller's HTTP library spells a boolean */
  it("reads any casing of true", () => {
    for (const spelling of ["true", "True", "TRUE", "1", "yes"]) {
      expect(allowUnstable(spelling)).toBe(true);
    }
  });

  /** @scenario A spelling the surface does not know is refused by name */
  it("refuses a spelling it does not know, naming the parameter", () => {
    const parsed = summaries({ allow_unstable: "maybe" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path.includes("allow_unstable"))).toBe(true);
  });
});
