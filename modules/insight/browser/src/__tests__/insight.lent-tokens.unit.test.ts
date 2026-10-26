/**
 * @vitest-environment jsdom
 * Insight lends its board control by analytics' board-header token, so the header draws it
 * without analytics importing insight (§10.1).
 * @see modules/insight/specs/insight-daily-run.feature
 */
import { BoardHeaderActionToken } from "@langwatch/analytics-client";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import { insightWeb } from "../insight.web.ts";
import { BoardDailyInsights } from "../ui/sections/board-daily-insights.tsx";

describe("the insight browser declaration", () => {
  describe("when a board header reads what is lent to it", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("loads the daily insights control", async () => {
      const lend = insightWeb.installation.lends.find(
        ({ token }) => token.key === BoardHeaderActionToken.key,
      );

      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toEqual({ default: BoardDailyInsights });
    });
  });

  describe("when the Insights page is guarded", () => {
    /** @scenario "The Insights page is a 404 while release_dashboards is off" */
    it("is behind both release_insights and release_dashboards", () => {
      const screen = insightWeb.installation.screens["pages/[project]/insights"];

      expect(screen?.flags).toEqual([
        FrontendFlags.release_insights,
        FrontendFlags.release_dashboards,
      ]);
    });
  });
});
