import { describe, expect, it } from "vitest";
import { LangyTurnSharedService } from "../langy-turn-shared.service.ts";

/** The shared turn helpers. Stateless: one instance for the module. */
const LANGY_TURN_SHARED = LangyTurnSharedService.create();

describe("langyTurnIdentity", () => {
  const base = {
    userId: "user-1",
    idempotencyKey: "key-1",
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  };

  it("derives the same identity for a byte-identical retry", () => {
    expect(LANGY_TURN_SHARED.langyTurnIdentity(base)).toEqual(
      LANGY_TURN_SHARED.langyTurnIdentity({ ...base }),
    );
  });

  it("derives a different identity when the content changes under the same key", () => {
    const other = LANGY_TURN_SHARED.langyTurnIdentity({
      ...base,
      messages: [{ role: "user", parts: [{ type: "text", text: "bye" }] }],
    });
    expect(other.turnId).not.toBe(LANGY_TURN_SHARED.langyTurnIdentity(base).turnId);
  });

  it("derives a different identity for another user with the same key and content", () => {
    const other = LANGY_TURN_SHARED.langyTurnIdentity({ ...base, userId: "user-2" });
    expect(other.turnId).not.toBe(LANGY_TURN_SHARED.langyTurnIdentity(base).turnId);
  });

  it("treats a model override change as different content", () => {
    const other = LANGY_TURN_SHARED.langyTurnIdentity({
      ...base,
      modelOverride: "openai/gpt-5-mini",
    });
    expect(other.turnId).not.toBe(LANGY_TURN_SHARED.langyTurnIdentity(base).turnId);
  });
});
