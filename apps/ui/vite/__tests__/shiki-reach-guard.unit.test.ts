/**
 * The guard reads the real output graph at build time; these pin how it walks it.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import { BOARD_PAGE_ROOTS, type GuardedChunk, shikiReachViolations } from "../shiki-reach-guard";

const chunk = (name: string, imports: string[] = [], extra: Partial<GuardedChunk> = {}) => ({
  name,
  imports,
  isEntry: false,
  facadeModuleId: null,
  ...extra,
});

const BOARD_SCREEN =
  "/repo/modules/analytics/browser/src/features/dashboards/ui/sections/dashboard-board.screen.tsx";

describe("given the output chunk graph", () => {
  describe("when a board screen reaches the shiki chunk through a static import", () => {
    /** @scenario "A page that only could show code does not load the highlighter" */
    it("reports the chain from the screen to shiki", () => {
      const chunks = {
        "board.js": chunk("dashboard-board.screen", ["markdown.js"], {
          facadeModuleId: BOARD_SCREEN,
        }),
        "markdown.js": chunk("markdown", ["lib.js"]),
        "lib.js": chunk("lib", ["shiki.js"]),
        "shiki.js": chunk("shiki"),
      };

      expect(shikiReachViolations({ chunks })).toEqual([
        ["dashboard-board.screen", "markdown", "lib", "shiki"],
      ]);
    });
  });

  describe("when the entry reaches shiki", () => {
    it("reports it", () => {
      const chunks = {
        "index.js": chunk("index", ["shiki.js"], { isEntry: true }),
        "shiki.js": chunk("shiki"),
      };

      expect(shikiReachViolations({ chunks })).toEqual([["index", "shiki"]]);
    });
  });

  describe("when shiki is reached only through a lazy screen", () => {
    it("reports nothing, since a dynamic import is not followed", () => {
      const chunks = {
        "index.js": chunk("index", ["adapter.js"], { isEntry: true }),
        // The adapter reaches shiki through import(), which is not in `imports`.
        "adapter.js": chunk("shiki-adapter"),
        "traces.js": chunk("traces-screen", ["shiki.js"]),
        "shiki.js": chunk("shiki"),
      };

      expect(shikiReachViolations({ chunks })).toEqual([]);
    });
  });

  describe("when naming the board page roots", () => {
    it("covers the dashboards screens and the layouts every board page loads", () => {
      for (const file of [
        BOARD_SCREEN,
        "/repo/modules/analytics/browser/src/features/dashboards/ui/sections/curated-board.screen.tsx",
        "/repo/modules/langy/browser/src/features/langy/ui/sections/project-langy-layout.tsx",
        "/repo/modules/trace/browser/src/ui/sections/explorer/global-trace-v2-drawer-mount.tsx",
      ]) {
        expect(
          BOARD_PAGE_ROOTS.some((root) => root.test(file)),
          file,
        ).toBe(true);
      }
    });
  });
});
