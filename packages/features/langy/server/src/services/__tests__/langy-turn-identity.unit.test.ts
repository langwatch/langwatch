import { describe, expect, it } from "vitest";
import { langyTurnIdentity } from "../langy-turn.shared";

describe("langyTurnIdentity", () => {
  const base = {
    userId: "user-1",
    idempotencyKey: "key-1",
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  };

  it("derives the same identity for a byte-identical retry", () => {
    expect(langyTurnIdentity(base)).toEqual(langyTurnIdentity({ ...base }));
  });

  it("derives a different identity when the content changes under the same key", () => {
    const other = langyTurnIdentity({
      ...base,
      messages: [{ role: "user", parts: [{ type: "text", text: "bye" }] }],
    });
    expect(other.turnId).not.toBe(langyTurnIdentity(base).turnId);
  });

  it("derives a different identity for another user with the same key and content", () => {
    const other = langyTurnIdentity({ ...base, userId: "user-2" });
    expect(other.turnId).not.toBe(langyTurnIdentity(base).turnId);
  });

  it("treats a model override change as different content", () => {
    const other = langyTurnIdentity({
      ...base,
      modelOverride: "openai/gpt-5-mini",
    });
    expect(other.turnId).not.toBe(langyTurnIdentity(base).turnId);
  });
});
