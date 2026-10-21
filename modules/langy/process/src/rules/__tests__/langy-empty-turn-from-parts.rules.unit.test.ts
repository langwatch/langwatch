import { describe, expect, it } from "vitest";

import {
  LANGY_EMPTY_TURN_FALLBACK,
  langyEmptyTurnLineFromParts,
} from "../langy-empty-turn.rules.ts";

describe("langyEmptyTurnLineFromParts", () => {
  it("names the code access card when the turn ended on it", () => {
    expect(langyEmptyTurnLineFromParts([{ type: "tool-code_access" }])).toBe(
      "I'm waiting for you to say how I should reach your code, on the card above.",
    );
  });

  it("falls back when there is no card to point at", () => {
    expect(langyEmptyTurnLineFromParts([])).toBe(LANGY_EMPTY_TURN_FALLBACK);
    expect(langyEmptyTurnLineFromParts([{ type: "tool-say" }])).toBe(LANGY_EMPTY_TURN_FALLBACK);
  });
});
