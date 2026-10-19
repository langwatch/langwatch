import { describe, expect, it } from "vitest";

import { turnIdempotencyKey } from "./turn-idempotency-key";

const base = { threadId: "thread_1", sessionNonce: "nonce-a", historyLength: 3 };

describe("turnIdempotencyKey()", () => {
  describe("when called twice with the same inputs", () => {
    it("returns the same key, so a replayed send stays deduplicated", () => {
      expect(turnIdempotencyKey(base)).toBe(turnIdempotencyKey({ ...base }));
    });
  });

  describe("when the framework history is longer", () => {
    it("returns a different key", () => {
      expect(turnIdempotencyKey({ ...base, historyLength: 4 })).not.toBe(turnIdempotencyKey(base));
    });
  });

  describe("when the session nonce is renewed", () => {
    it("returns a different key, so a reset session never reuses the failed attempt's key", () => {
      expect(turnIdempotencyKey({ ...base, sessionNonce: "nonce-b" })).not.toBe(
        turnIdempotencyKey(base),
      );
    });
  });

  describe("when composing the key", () => {
    it("joins thread, nonce and history length with #", () => {
      expect(turnIdempotencyKey(base)).toBe("thread_1#nonce-a#3");
    });
  });
});
