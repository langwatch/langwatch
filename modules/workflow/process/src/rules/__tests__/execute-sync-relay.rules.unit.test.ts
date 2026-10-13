import { describe, expect, it } from "vitest";

import { RELAY_TURN_CEILING_DEFAULT_MS, relayTurnCeilingMs } from "../execute-sync-relay.rules.ts";

describe("relayTurnCeilingMs", () => {
  it("honours a positive whole number of milliseconds", () => {
    expect(relayTurnCeilingMs({ configured: 1_800_000 })).toBe(1_800_000);
  });

  it.each([undefined, 0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "reads %s as the 15 minute default",
    (configured) => {
      expect(relayTurnCeilingMs({ configured })).toBe(RELAY_TURN_CEILING_DEFAULT_MS);
    },
  );
});
