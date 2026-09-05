/**
 * Who decides which families a process serves. Every family builds its own app
 * in its own file and hands it over; the framework mounts exactly what it is
 * given and carries no list of families of its own — which is what lets a
 * process add, drop or reorder one without touching this package.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import type { MountedRoute } from "../types.js";

/** One family's own file: it builds its own app and knows only its own routes. */
function buildInvoicesFamily(onRouteMounted: (route: MountedRoute) => void) {
  return createService({ name: "invoices", basePath: "/api/invoices", onRouteMounted })
    .registerRoute(
      "get",
      "/",
      "2025-03-15",
      async () => [] as string[],
      (b) => b.withOutput(z.array(z.string())),
    )
    .build();
}

/** A second family, built the same way and knowing nothing of the first. */
function buildLedgersFamily(onRouteMounted: (route: MountedRoute) => void) {
  return createService({ name: "ledgers", basePath: "/api/ledgers", onRouteMounted })
    .registerRoute(
      "get",
      "/",
      "2025-03-15",
      async () => [] as string[],
      (b) => b.withOutput(z.array(z.string())),
    )
    .build();
}

describe("the application as the composition root", () => {
  describe("when two families are mounted", () => {
    /** @scenario The application is the composition root */
    it("serves exactly the families the composition handed over, each from its own file", async () => {
      const mounted: MountedRoute[] = [];
      // The composition root: it names the families, the framework does not.
      const families = [
        buildInvoicesFamily((route) => mounted.push(route)),
        buildLedgersFamily((route) => mounted.push(route)),
      ];

      // Each family answers on its own base path, from its own app, and
      // neither app knows the other's routes.
      const invoicesPath = mounted.find((route) => route.path.includes("/invoices/"))?.path ?? "";
      const ledgersPath = mounted.find((route) => route.path.includes("/ledgers/"))?.path ?? "";
      expect((await families[0]!.request(`http://local${invoicesPath}`)).status).toBe(200);
      expect((await families[1]!.request(`http://local${ledgersPath}`)).status).toBe(200);
      expect((await families[0]!.request(`http://local${ledgersPath}`)).status).toBe(404);

      // Every mount the framework reported traces back to a family that built
      // itself; nothing arrived from a list inside the framework.
      const bases = [...new Set(mounted.map((route) => route.path.split("/")[2]))].sort();
      expect(bases).toEqual(["invoices", "ledgers"]);
    });

    /** @scenario The application is the composition root */
    it("mounts only the family it was given, when the composition names one", async () => {
      const mounted: MountedRoute[] = [];

      buildInvoicesFamily((route) => mounted.push(route));

      // Dropping a family from the composition drops it from the surface: the
      // framework never re-adds one it "knows about".
      expect(mounted.every((route) => route.path.startsWith("/api/invoices"))).toBe(true);
      expect(mounted.length).toBeGreaterThan(0);
    });
  });
});
