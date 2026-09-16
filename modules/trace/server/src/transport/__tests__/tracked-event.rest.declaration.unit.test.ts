/**
 * @vitest-environment node
 * The tracked-event family is only reachable if the MODULE declares it. It was
 * written, exported from `index.ts`, and declared by nobody, so every
 * `POST /api/events/track` a released SDK sent answered 404 while the code to
 * serve it sat in the tree — apidiff read the address as removed against main
 * (run 20260916-101543). This pins the declaration, not the handler.
 */
import { describe, expect, it } from "vitest";

import { traceServer } from "../../trace.server.ts";
import { trackedEventRest, trackedEventLegacyPathRest } from "../tracked-event.rest.ts";

const declaration = trackedEventRest.router();

describe("the tracked-event family", () => {
  describe("given the transports the trace module declares", () => {
    it("declares the canonical tracked-event route", () => {
      expect(traceServer.transports).toContain(trackedEventRest);
    });

    it("reports the event the caller posted under the canonical operation", () => {
      expect(declaration.routes.map((route) => route.operation)).toContain("trackEvent");
    });
  });

  describe("given the legacy `/api/track_event` alias", () => {
    /**
     * The alias replays the request into the canonical route rather than
     * handling it a second time, so it needs an app member that can dispatch a
     * `Request` back into the mounted family. Nothing in the repository
     * implements that yet — `experimentV3AliasRest` is the same shape and is
     * unmounted for the same reason — so the alias stays undeclared instead of
     * being mounted over a member that would throw on every call.
     */
    it("stays undeclared until an app can replay a request into the canonical route", () => {
      expect(traceServer.transports).not.toContain(trackedEventLegacyPathRest);
    });
  });
});
