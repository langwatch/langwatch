import { describe, expect, it } from "vitest";

import { dejaViewHref } from "../ops-event-log.ts";

describe("dejaViewHref", () => {
  it("addresses the aggregate and its tenant in the fragment", () => {
    expect(dejaViewHref({ aggregateId: "run_1", tenantId: "project_1" })).toBe(
      "/ops/dejaview#a=run_1&at=project_1",
    );
  });
});
