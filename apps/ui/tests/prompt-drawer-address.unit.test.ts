/**
 * The address the trace drawer opens at, from a Prompt Studio playground turn.
 *
 * `traceV2Details` is the trace drawer, opened by most of the product, so the
 * chat's View Trace affordance names it and this function writes the address
 * the rest of the product already produces. It is not a REGISTERED drawer and
 * cannot be — its URL sync has to outlive `?drawer.open=` — so what answers the
 * address is the mount `ui-app-chrome` draws beside `CurrentDrawer`. Getting
 * that address wrong is silent in both directions: a missing `drawer.traceId`
 * opens an empty drawer, and a LEFTOVER key from a previous drawer opens the
 * one the reader looked at before this one.
 *
 * Spec: specs/prompts/prompt-studio-page.feature
 */

import { describe, expect, it } from "vitest";
import { resolvePromptDrawerAddress } from "../src/features/prompt/behavior/prompt-drawer-address";

describe("given the prompt drawer address", () => {
  describe("when a screen addresses the trace drawer", () => {
    /** @scenario "Opening a trace from a playground turn addresses the trace drawer" */
    it("writes the drawer's name and its own parameters under the drawer prefix", () => {
      const next = resolvePromptDrawerAddress({
        query: {},
        drawer: "traceV2Details",
        params: { traceId: "trace_1" },
      });

      expect(next).toEqual({
        "drawer.open": "traceV2Details",
        "drawer.traceId": "trace_1",
      });
    });

    /** @scenario "Opening a trace from a playground turn addresses the trace drawer" */
    it("clears a stale drawer parameter left by whatever was open before", () => {
      const next = resolvePromptDrawerAddress({
        query: {
          "drawer.open": "somethingElse",
          "drawer.datasetId": "dataset_1",
          project: "web-app",
        },
        drawer: "traceV2Details",
        params: { traceId: "trace_1" },
      });

      // The clearing IS the behaviour here, so the key has to be present and
      // the value has to be `undefined` — `toHaveBeenCalledWith`-style
      // property-absence checks would pass even if the clearing stopped.
      expect(Object.keys(next).sort()).toEqual(["drawer.datasetId", "drawer.open", "drawer.traceId"]);
      expect(next["drawer.datasetId"]).toBeUndefined();
      expect(next["drawer.open"]).toBe("traceV2Details");
      expect(next["drawer.traceId"]).toBe("trace_1");
      expect(next).not.toHaveProperty("project");
    });
  });
});
