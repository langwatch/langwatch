/**
 * @vitest-environment jsdom
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { currentSessionId, SESSION_INACTIVITY_MS } from "./session";

describe("currentSessionId", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe("given a visit in progress", () => {
    describe("when the visitor keeps acting", () => {
      /** scenario "Everything from one visit can be found together" */
      it("keeps naming the same session", () => {
        const first = currentSessionId(1_000);

        expect(first).toBeDefined();
        expect(currentSessionId(2_000)).toBe(first);
        expect(currentSessionId(3_000)).toBe(first);
      });
    });

    describe("when they pause for less than the inactivity window", () => {
      it("stays the same session", () => {
        const first = currentSessionId(1_000);

        expect(currentSessionId(1_000 + SESSION_INACTIVITY_MS - 1)).toBe(first);
      });
    });

    describe("when the session is first named", () => {
      it("names it in the shape OpenTelemetry expects", () => {
        expect(currentSessionId(1_000)).toMatch(/^[0-9a-f]{32}$/);
      });
    });
  });

  describe("given the visit has gone quiet", () => {
    describe("when they come back past the inactivity window", () => {
      /**
       * An abandoned tab reopened the next day is a new visit, not a
       * twenty-hour one.
       */
      it("starts a new session", () => {
        const first = currentSessionId(1_000);
        const later = currentSessionId(1_000 + SESSION_INACTIVITY_MS + 1);

        expect(later).toBeDefined();
        expect(later).not.toBe(first);
      });
    });

    describe("when activity continues after the new session starts", () => {
      it("keeps the new session", () => {
        currentSessionId(1_000);
        const second = currentSessionId(1_000 + SESSION_INACTIVITY_MS + 1);

        expect(currentSessionId(1_000 + SESSION_INACTIVITY_MS + 2)).toBe(second);
      });
    });
  });

  describe("given storage is unavailable", () => {
    describe("when a session is asked for", () => {
      /**
       * Safari's private mode throws on `sessionStorage`. Telemetry must never
       * be the reason a page fails to load.
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
});
