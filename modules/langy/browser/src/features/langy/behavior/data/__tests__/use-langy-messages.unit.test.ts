/**
 * The history poll for a conversation this tab just minted (#7987): its first read races the
 * async fold and 404s, and a 404 is never retried, so only this poll re-asks.
 */
import { describe, expect, it } from "vitest";

import { langyMessagesPollInterval } from "../use-langy-messages.ts";

describe("langyMessagesPollInterval", () => {
  describe("given a freshly minted conversation that has produced no data", () => {
    it("polls about every second, so a not-found read is 'not yet', never settled", () => {
      expect(langyMessagesPollInterval(undefined, true)).toBe(1_000);
    });

    it("stops the moment data lands", () => {
      expect(langyMessagesPollInterval({ messages: [] }, true)).toBe(false);
    });
  });

  describe("given a confirmed conversation", () => {
    it("does not poll, with or without data", () => {
      expect(langyMessagesPollInterval(undefined, false)).toBe(false);
      expect(langyMessagesPollInterval({ messages: [] }, false)).toBe(false);
    });
  });
});
