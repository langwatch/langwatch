import { describe, expect, it } from "vitest";
import { InFlightTracker, shouldIgnoreRequest } from "../settle";

const settings = { quietMillis: 500, deadlineMillis: 20_000 };

describe("Feature: Visual diff between two refs", () => {
  describe("given a page with requests in flight", () => {
    describe("when the runner settles", () => {
      /** @scenario The runner settles on the in-flight request count rather than a fixed wait */
      it("stays busy until the count reaches zero and the quiet window passes", () => {
        const tracker = new InFlightTracker(settings, 0);
        tracker.started({ url: "http://app/api/traces", resourceType: "fetch" });

        expect(tracker.decide(10_000).quiet).toBe(false);

        tracker.settled({ url: "http://app/api/traces", resourceType: "fetch", now: 10_000 });

        expect(tracker.decide(10_100).quiet).toBe(false);
        expect(tracker.decide(10_500).quiet).toBe(true);
      });

      /** @scenario The runner settles on the in-flight request count rather than a fixed wait */
      it("gives up at the settle deadline rather than hanging", () => {
        const tracker = new InFlightTracker(settings, 0);
        tracker.started({ url: "http://app/api/poll", resourceType: "fetch" });

        expect(tracker.decide(19_999).expired).toBe(false);
        expect(tracker.decide(20_000)).toEqual({ quiet: false, expired: true });
      });

      it("never counts below zero when a response arrives without its request", () => {
        const tracker = new InFlightTracker(settings, 0);

        tracker.settled({ url: "http://app/api/x", resourceType: "fetch", now: 100 });

        expect(tracker.inFlight).toBe(0);
      });
    });
  });

  describe("given an open event stream and a Vite hot-update request", () => {
    describe("when the runner counts in-flight requests", () => {
      /** @scenario The runner ignores server-sent events and Vite hot updates while settling */
      it("ignores both and counts a normal API request", () => {
        const ignored = [
          { url: "http://app/api/runs/stream", resourceType: "fetch" },
          { url: "http://app/api/scenario/events", resourceType: "fetch" },
          { url: "http://app/anything", resourceType: "eventsource" },
          { url: "http://app/anything", resourceType: "websocket" },
          { url: "http://app/@vite/client", resourceType: "script" },
          { url: "http://app/src/app.tsx?t=1757160000000", resourceType: "script" },
          { url: "http://app/node_modules/.vite/deps/react.js", resourceType: "script" },
          { url: "http://app/src/x.tsx?hot-update", resourceType: "script" },
        ];

        for (const request of ignored) {
          expect(shouldIgnoreRequest(request)).toBe(true);
        }
        expect(shouldIgnoreRequest({ url: "http://app/api/traces", resourceType: "fetch" })).toBe(
          false,
        );
      });

      /** @scenario The runner ignores server-sent events and Vite hot updates while settling */
      it("settles while an event stream is still open", () => {
        const tracker = new InFlightTracker(settings, 0);

        tracker.started({ url: "http://app/api/runs/stream", resourceType: "fetch" });

        expect(tracker.inFlight).toBe(0);
        expect(tracker.decide(600).quiet).toBe(true);
      });
    });
  });

  describe("given a new settle window", () => {
    describe("when the tracker restarts", () => {
      it("carries the in-flight count and resets the deadline", () => {
        const tracker = new InFlightTracker(settings, 0);
        tracker.started({ url: "http://app/api/traces", resourceType: "fetch" });

        const restarted = tracker.restart(19_000);

        expect(restarted.inFlight).toBe(1);
        expect(restarted.decide(20_000).expired).toBe(false);
      });
    });
  });
});
