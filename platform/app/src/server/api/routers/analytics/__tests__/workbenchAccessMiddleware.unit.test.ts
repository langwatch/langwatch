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
 * No database, no containers: this reads the mounted router as it was built.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import { appRouter } from "../../../root";
import { enforceWorkbenchEnabled } from "../workbenchAccessMiddleware";

/**
 * The middleware chain tRPC composed for each procedure under one namespace,
 * keyed by the name that namespace answers on.
 *
 * Read off the real `appRouter` rather than off a router built here: the claim
 * is that the gate is attached to the surface the process SERVES, and a
 * separately built copy could carry it while the mounted one did not.
 */
function chainsOf(namespace: string): Record<string, unknown[]> {
  const procedures = (
    appRouter as unknown as {
      _def: {
        procedures: Record<string, { _def: { middlewares: unknown[] } }>;
      };
    }
  )._def.procedures;

  const prefix = `${namespace}.`;

  return Object.fromEntries(
    Object.entries(procedures)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, procedure]) => [path.slice(prefix.length), procedure._def.middlewares]),
  );
}

function gatedProcedures(namespace: string): string[] {
  return Object.entries(chainsOf(namespace))
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
      expect(gatedProcedures("analytics.savedWorkbenchCharts")).toEqual([
        "create",
        "delete",
        "getAll",
        "getById",
        "run",
        "update",
      ]);
      // And the closure: a sixth procedure added without the gate fails here.
      expect(gatedProcedures("analytics.savedWorkbenchCharts")).toEqual(
        Object.keys(chainsOf("analytics.savedWorkbenchCharts")).sort(),
      );
    });
  });

  describe("given the LangWatchQL router", () => {
    it("gates everything except the procedure whose answer is the switch", () => {
      // `availability` reads the switch rather than being refused by it: it is
      // what the navigation asks, and it has to be able to answer "off".
      expect(gatedProcedures("analytics.lwql")).toEqual(["query", "schema"]);
    });
  });
});
