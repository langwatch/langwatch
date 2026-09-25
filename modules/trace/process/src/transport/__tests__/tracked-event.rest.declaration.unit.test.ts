/**
 * @vitest-environment node
 * A family is only reachable if the MODULE declares it: both these addresses
 * were written, exported, and declared by nobody, so a released SDK was
 * answered 404 by a tree that held the code. Pins the declaration, not the handler.
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
     * The alias answers for itself over the canonical route's own handler, the
     * way the monolith shared one service between the two addresses, so it
     * needs no member that can dispatch a `Request` back into a mounted family.
     */
    it("is declared, so a pre-rename SDK release still reaches the family", () => {
      expect(traceServer.transports).toContain(trackedEventLegacyPathRest);
    });

    it("reads the same credential and asks the same permission as the canonical route", () => {
      const alias = trackedEventLegacyPathRest.router();
      const canonical = declaration.routes[0]!;

      expect(alias.credential).toBe("project");
      expect(alias.routes[0]!.permission).toBe(canonical.permission);
    });

    it("is published under Events, as main documented it", () => {
      const docs = trackedEventLegacyPathRest.router().routes[0]!.docs;

      expect(docs?.hide).toBeUndefined();
      expect(docs?.tags).toEqual(["Events"]);
    });
  });
});
