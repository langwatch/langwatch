import { describe, expect, it } from "vitest";

import { turnIdempotencyKey } from "./turn-idempotency-key";

const messages = [{ role: "user", parts: [{ type: "text", text: "hello" }] }];
const base = { threadId: "thread_1", sessionNonce: "nonce-a", historyLength: 3, messages };

describe("turnIdempotencyKey()", () => {
  describe("when called twice with the same inputs", () => {
    it("returns the same key, so a replayed send stays deduplicated", () => {
      expect(turnIdempotencyKey(base)).toBe(turnIdempotencyKey({ ...base }));
    });
  });

  describe("when the payload is deep-equal at the same length", () => {
    it("returns the same key", () => {
      const copy = JSON.parse(JSON.stringify(messages));
      expect(turnIdempotencyKey({ ...base, messages: copy })).toBe(turnIdempotencyKey(base));
    });
  });

  describe("when the history length is the same but the content differs", () => {
    it("returns a different key, so the server sees two distinct sends", () => {
      const other = [{ role: "user", parts: [{ type: "text", text: "goodbye" }] }];
      expect(turnIdempotencyKey({ ...base, messages: other })).not.toBe(turnIdempotencyKey(base));
    });
  });

  describe("when the content is the same but the framework history is longer", () => {
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
    it("joins thread, nonce, history length and a 16-char payload hash with #", () => {
      expect(turnIdempotencyKey(base)).toMatch(/^thread_1#nonce-a#3#[0-9a-f]{16}$/);
    });
  });
});
