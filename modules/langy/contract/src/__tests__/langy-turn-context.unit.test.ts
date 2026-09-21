/**
 * The live UI-action line is advertised only when the flag has opened the
 * channel AND a chip says the user is on a page that can be driven, so the
 * agent never spends a turn on a dark route.
 */
import { describe, expect, it } from "vitest";

import { renderLangyTurnContext } from "../langy-turn-context.ts";

const experimentChip = { kind: "experiment", ref: "my-exp", label: "my-exp" } as const;

const explorerViewChip = {
  kind: "filter",
  ref: "data source: traces; time range: Last 30 days",
  label: "Traces · All · Last 30 days",
} as const;

describe("renderLangyTurnContext - the live UI-action line", () => {
  describe("given the UI-action surface is open", () => {
    it("tells the agent the page can be driven live", () => {
      const block = renderLangyTurnContext({
        context: { pageContext: [experimentChip] },
        isUiActionSurfaceOpen: true,
      });

      expect(block).toContain("langwatch ui actions");
      expect(block).toContain("langwatch ui call");
    });
  });

  describe("given the UI-action surface is closed", () => {
    it("says nothing about the commands the dispatch route would refuse", () => {
      const block = renderLangyTurnContext({
        context: { pageContext: [experimentChip] },
        isUiActionSurfaceOpen: false,
      });

      expect(block).not.toContain("langwatch ui actions");
      expect(block).not.toContain("langwatch ui call");
      // The flag closes ONE channel; it does not blind the agent to the screen.
      expect(block).toContain("my-exp");
    });
  });

  describe("given the Trace Explorer's view chip", () => {
    /** @scenario "The traces page chips advertise live UI actions" */
    it("tells the agent the Explorer can be driven live", () => {
      const block = renderLangyTurnContext({
        context: { pageContext: [explorerViewChip] },
        isUiActionSurfaceOpen: true,
      });

      expect(block).toContain("langwatch ui actions");
    });
  });

  describe("given the Trace Explorer's selection chip", () => {
    /** @scenario "The traces page chips advertise live UI actions" */
    it("advertises the page the selection was made on", () => {
      const block = renderLangyTurnContext({
        context: {
          pageContext: [{ kind: "selection", ref: "t1,t2,t3", label: "3 traces selected" }],
        },
        isUiActionSurfaceOpen: true,
      });

      expect(block).toContain("langwatch ui actions");
    });
  });

  describe("given a page with no UI-action manifest", () => {
    it("stays silent even with the surface open", () => {
      const block = renderLangyTurnContext({
        context: { pageContext: [{ kind: "trace", ref: "abc123", label: "trace abc" }] },
        isUiActionSurfaceOpen: true,
      });

      expect(block).not.toContain("langwatch ui actions");
    });
  });
});
