/**
 * Which page owns a dispatched action's manifest, by address alone
 * (specs/langy/langy-ui-actions.feature).
 */
import { describe, expect, it } from "vitest";

import { isOnPageOwningAction } from "../manifest-routes.ts";

describe("isOnPageOwningAction", () => {
  describe("when the browser is on the Trace Explorer", () => {
    it("owns the explorer kinds, with or without a trailing path", () => {
      for (const pathname of ["/acme/traces", "/acme/traces/", "/acme/traces/abc"]) {
        expect(isOnPageOwningAction({ kind: "explorer.setTimeRange", pathname })).toBe(true);
      }
    });
  });

  describe("when the browser is somewhere else", () => {
    it("does not own the explorer kinds", () => {
      for (const pathname of ["/acme/datasets", "/acme", "/acme/traces-old"]) {
        expect(isOnPageOwningAction({ kind: "explorer.setFilter", pathname })).toBe(false);
      }
    });
  });

  describe("when the kind belongs to a manifest with no listed route", () => {
    it("is never held", () => {
      expect(
        isOnPageOwningAction({
          kind: "workbench.duplicateTarget",
          pathname: "/acme/traces",
        }),
      ).toBe(false);
    });
  });
});
