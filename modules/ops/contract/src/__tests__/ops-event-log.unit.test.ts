import { describe, expect, it } from "vitest";

import { opsSearchAggregatesInputSchema } from "../index.ts";

describe("opsSearchAggregatesInputSchema", () => {
  /** @scenario "An event-log search with no query and no tenant is refused as invalid input" */
  it("refuses an empty or blank query with no tenant", () => {
    expect(opsSearchAggregatesInputSchema.validate({ query: "" })).toBe(false);
    expect(opsSearchAggregatesInputSchema.validate({ query: "   " })).toBe(false);
    expect(opsSearchAggregatesInputSchema.validate({ query: "", tenantId: "" })).toBe(false);
  });

  /** @scenario "An event-log search bounded by a query or a tenant is accepted" */
  it("accepts a query, or a tenant with no query", () => {
    expect(opsSearchAggregatesInputSchema.validate({ query: "trace_abc" })).toBe(true);
    expect(opsSearchAggregatesInputSchema.validate({ query: "", tenantId: "project_1" })).toBe(
      true,
    );
  });
});
