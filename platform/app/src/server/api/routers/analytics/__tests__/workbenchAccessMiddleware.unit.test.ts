/**
 * @vitest-environment node
 *
 * That the gate is actually on every procedure it is meant to be on.
 *
 * The router suites prove what the gate DOES; this proves it is attached. The
 * two are different claims, and it is the second one that rots: a procedure
 * added later to a router that gates procedure-by-procedure is switched-on by
 * default, and nothing fails — the surface is simply reachable with the flag
 * off. Reading the composed chain is what notices.
 *
 * No database, no containers: this reads the routers as they are built.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see specs/analytics/lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import { lwqlRouter } from "../lwql";
import { savedWorkbenchChartsRouter } from "../savedWorkbenchCharts";
import { enforceWorkbenchEnabled } from "../workbenchAccessMiddleware";

/** The middleware chain tRPC composed for each procedure, keyed by its name. */
function chainsOf(router: unknown): Record<string, unknown[]> {
  const procedures = (
    router as {
      _def: {
        procedures: Record<string, { _def: { middlewares: unknown[] } }>;
      };
    }
  )._def.procedures;

  return Object.fromEntries(
    Object.entries(procedures).map(([name, procedure]) => [
      name,
      procedure._def.middlewares,
    ]),
  );
}

function gatedProcedures(router: unknown): string[] {
  return Object.entries(chainsOf(router))
    .filter(([, chain]) => chain.includes(enforceWorkbenchEnabled))
    .map(([name]) => name)
    .sort();
}

describe("the workbench feature gate", () => {
  describe("given the saved-chart router", () => {
    it("gates every procedure on it, reads included", () => {
      // The exact list first: two derived-and-compared arrays could both be
      // empty — a `_def` shape change would pass vacuously — and the names pin
      // the `_def.procedures` reading this file depends on.
      expect(gatedProcedures(savedWorkbenchChartsRouter)).toEqual([
        "create",
        "delete",
        "getAll",
        "getById",
        "run",
        "update",
      ]);
      // And the closure: a sixth procedure added without the gate fails here.
      expect(gatedProcedures(savedWorkbenchChartsRouter)).toEqual(
        Object.keys(chainsOf(savedWorkbenchChartsRouter)).sort(),
      );
    });
  });

  describe("given the LangWatchQL router", () => {
    it("gates everything except the procedure whose answer is the switch", () => {
      // `availability` reads the switch rather than being refused by it: it is
      // what the navigation asks, and it has to be able to answer "off".
      expect(gatedProcedures(lwqlRouter)).toEqual(["query", "schema"]);
    });
  });
});
