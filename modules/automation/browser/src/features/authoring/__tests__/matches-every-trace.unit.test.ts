import { describe, expect, it } from "vitest";

import { matchesEveryTrace } from "../model/matches-every-trace.ts";

describe("matchesEveryTrace", () => {
  it("is true with no query, empty filters and no checks", () => {
    expect(matchesEveryTrace({ filterQuery: null, filters: "{}" })).toBe(true);
    expect(matchesEveryTrace({ filterQuery: "  ", filters: null })).toBe(true);
    expect(matchesEveryTrace({ filterQuery: "", filters: '{"spans.model":[]}' })).toBe(true);
  });

  it("is false once a query, a filter or a check narrows it", () => {
    expect(matchesEveryTrace({ filterQuery: "status:error", filters: "{}" })).toBe(false);
    expect(matchesEveryTrace({ filterQuery: null, filters: '{"spans.model":["x"]}' })).toBe(false);
    expect(matchesEveryTrace({ filterQuery: null, filters: "{}", checkCount: 1 })).toBe(false);
  });
});
