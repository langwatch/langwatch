/**
 * @vitest-environment jsdom
 *
 * Binds the scenario `Everything from one visit can be found together` in
 * specs/observability/browser-rum-trace-correlation.feature. See ADR-058.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { currentSessionId, SESSION_INACTIVITY_MS } from "./session";

describe("currentSessionId", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe("given a visit in progress", () => {
    it("keeps naming the same session", () => {
      const first = currentSessionId(1_000);

      expect(first).toBeDefined();
      expect(currentSessionId(2_000)).toBe(first);
      expect(currentSessionId(3_000)).toBe(first);
    });

    it("stays the same across a gap shorter than the inactivity window", () => {
      const first = currentSessionId(1_000);

      expect(currentSessionId(1_000 + SESSION_INACTIVITY_MS - 1)).toBe(first);
    });

    it("names the session in the shape OpenTelemetry expects", () => {
      expect(currentSessionId(1_000)).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("given the visit has gone quiet", () => {
    /**
     * An abandoned tab reopened the next day is a new visit, not a
     * twenty-hour one.
     */
    it("starts a new session past the inactivity window", () => {
      const first = currentSessionId(1_000);
      const later = currentSessionId(1_000 + SESSION_INACTIVITY_MS + 1);

      expect(later).toBeDefined();
      expect(later).not.toBe(first);
    });

    it("then keeps the new session while activity continues", () => {
      currentSessionId(1_000);
      const second = currentSessionId(1_000 + SESSION_INACTIVITY_MS + 1);

      expect(currentSessionId(1_000 + SESSION_INACTIVITY_MS + 2)).toBe(second);
    });
  });

  describe("given storage is unavailable", () => {
    /**
     * Safari's private mode throws on `sessionStorage`. Telemetry must never be
     * the reason a page fails to load.
     */
    it("gives up quietly rather than throwing", () => {
      vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
        throw new Error("denied");
      });

      expect(() => currentSessionId(1_000)).not.toThrow();
      expect(currentSessionId(1_000)).toBeUndefined();

      vi.restoreAllMocks();
    });
  });
});
