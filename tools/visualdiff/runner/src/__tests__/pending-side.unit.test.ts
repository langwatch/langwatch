import { describe, expect, it } from "vitest";

import { readPendingSide } from "../pending-side.ts";

const definition = { name: "base", baseUrl: "", pending: "/run/base-side.json" };

describe("Feature: visualdiff catches regressions and reports its own coverage", () => {
  describe("given a base that boots after the candidate", () => {
    /** @scenario The candidate captures while the base is still booting */
    it("opens the base at the address and fixtures its pending file names", () => {
      const side = readPendingSide({
        definition,
        text: JSON.stringify({ baseUrl: "https://app.base", fixtures: { dataset: "ds_1" } }),
      });

      expect(side).toEqual({
        name: "base",
        baseUrl: "https://app.base",
        fixtures: { dataset: "ds_1" },
      });
    });

    /** @scenario The candidate captures while the base is still booting */
    it("stops with the reason the base never came up", () => {
      expect(() =>
        readPendingSide({ definition, text: JSON.stringify({ error: "haven gave up on stack" }) }),
      ).toThrow("base never came up: haven gave up on stack");
    });
  });
});
