import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InFlightTracker,
  isPageReady,
  LONG_LIVED_MILLIS,
  readyMarker,
  shouldIgnoreRequest,
  USER_MENU_SELECTOR,
} from "../settle.ts";

const settings = { quietMillis: 500, deadlineMillis: 8000 };

const request = (url: string) => ({ key: url, url, resourceType: "fetch" });

describe("Feature: Visual diff between two refs", () => {
  describe("given a page with requests in flight", () => {
    describe("when the runner settles", () => {
      /** @scenario The runner settles on the in-flight request count rather than a fixed wait */
      it("stays busy until the count reaches zero and the quiet window passes", () => {
        const tracker = new InFlightTracker<string>(settings, 0);
        tracker.started({ ...request("http://app/api/traces"), now: 0 });

        expect(tracker.decide(2000).quiet).toBe(false);

        tracker.settled({ key: "http://app/api/traces", now: 2000 });

        expect(tracker.decide(2100).quiet).toBe(false);
        expect(tracker.decide(2500).quiet).toBe(true);
      });

      /** @scenario The runner settles on the in-flight request count rather than a fixed wait */
      it("gives up at the settle deadline rather than hanging", () => {
        const tracker = new InFlightTracker<string>(settings, 0);
        tracker.started({ ...request("http://app/api/poll"), now: 0 });
        tracker.started({ ...request("http://app/api/slow"), now: 6000 });

        expect(tracker.decide(7999).expired).toBe(false);
        expect(tracker.decide(8000)).toEqual({ quiet: false, expired: true });
        expect(tracker.waitingOn(8000).map((pending) => pending.startedAt)).toEqual([6000]);
      });

      it("ignores a response that arrives without its request", () => {
        const tracker = new InFlightTracker<string>(settings, 0);

        tracker.settled({ key: "http://app/api/x", now: 100 });

        expect(tracker.inFlight(100)).toEqual([]);
        expect(tracker.decide(500).quiet).toBe(true);
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
          { url: "http://app/api/rum/v1/traces", resourceType: "fetch" },
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
        const tracker = new InFlightTracker<string>(settings, 0);

        tracker.started({ ...request("http://app/api/runs/stream"), now: 0 });

        expect(tracker.inFlight(0)).toEqual([]);
        expect(tracker.decide(600).quiet).toBe(true);
      });
    });
  });

  describe("given a new settle window", () => {
    describe("when the tracker begins it", () => {
      it("keeps the requests still in flight and resets the deadline", () => {
        const tracker = new InFlightTracker<string>(settings, 0);
        tracker.started({ ...request("http://app/api/traces"), now: 6000 });

        tracker.begin(7000);

        expect(tracker.inFlight(7000)).toEqual(["http://app/api/traces"]);
        expect(tracker.decide(8000).expired).toBe(false);
      });
    });
  });

  describe("given a request that never reports back", () => {
    describe("when the page navigates away", () => {
      /** @scenario A request that never reports back does not hold later captures to the deadline */
      it("forgets it, so the next screen settles on its own requests", () => {
        const tracker = new InFlightTracker<string>(settings, 0);
        tracker.started({ ...request("http://app/api/automations/lost"), now: 0 });

        tracker.navigated(1000);
        tracker.begin(1000);

        expect(tracker.decide(1500)).toEqual({ quiet: true, expired: false });
      });
    });

    describe("when it is older than the long-lived age", () => {
      /** @scenario A request that never reports back does not hold later captures to the deadline */
      it("stops waiting on it and lists it as long-lived", () => {
        const tracker = new InFlightTracker<string>(
          { quietMillis: 500, deadlineMillis: 20_000 },
          0,
        );
        tracker.started({ ...request("http://app/api/poll"), now: 0 });

        expect(tracker.decide(LONG_LIVED_MILLIS - 1).quiet).toBe(false);
        expect(tracker.decide(LONG_LIVED_MILLIS + 499).quiet).toBe(false);
        expect(tracker.decide(LONG_LIVED_MILLIS + 500).quiet).toBe(true);
        expect(tracker.longLived(LONG_LIVED_MILLIS)).toEqual(["http://app/api/poll"]);
        expect(tracker.inFlight(LONG_LIVED_MILLIS)).toEqual([]);
      });
    });
  });
});

describe("Feature: Visual diff between two refs", () => {
  describe("given a screen waiting on the signed-in header", () => {
    afterEach(() => vi.unstubAllGlobals());

    const page = ({ header }: { header: boolean }) => {
      class Shown {}
      vi.stubGlobal("HTMLElement", Shown);
      const marker = Object.assign(new Shown(), { getClientRects: () => [{}] });
      vi.stubGlobal("document", {
        body: { textContent: "Traces" },
        querySelectorAll: () => [],
        querySelector: () => (header ? marker : null),
      });
    };

    describe("when the ready marker is missing", () => {
      /** @scenario The runner settles on the in-flight request count rather than a fixed wait */
      it("is not ready", () => {
        page({ header: false });
        expect(isPageReady({ loading: ".x", ready: USER_MENU_SELECTOR })).toBe(false);
      });
    });

    describe("when the marker is visible", () => {
      it("is ready", () => {
        page({ header: true });
        expect(isPageReady({ loading: ".x", ready: USER_MENU_SELECTOR })).toBe(true);
      });
    });

    describe("when the route is public", () => {
      it("needs no marker, and a side's own selector wins on signed-in routes", () => {
        expect(readyMarker({ path: "/share/abc" })).toBe("");
        expect(readyMarker({ path: "/auth/signin" })).toBe("");
        expect(readyMarker({ path: "/p/traces" })).toBe(USER_MENU_SELECTOR);
        expect(readyMarker({ path: "/p/traces", selector: "#me" })).toBe("#me");
        page({ header: false });
        expect(isPageReady({ loading: ".x", ready: "" })).toBe(true);
      });
    });
  });
});
