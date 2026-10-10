import { describe, expect, it } from "vitest";

import { scimRequestLogRetentionStateSchema } from "../scim-request-log-retention.process.ts";

describe("process state stored by the main release", () => {
  it("parses a request log retention state as main stored it", () => {
    expect(scimRequestLogRetentionStateSchema.parse({ lastSweepAt: null })).toEqual({
      lastSweepAt: null,
    });
  });
});
