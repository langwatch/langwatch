/**
 * What a browser installs when it installs insight: the inbox screen behind
 * `release_insights`, and what it lends the shell, Langy and a board's header (the bell, the
 * sidebar count, "Save as insight" and "Daily insights"). All lazy; none is on first paint.
 */

import { BoardHeaderActionToken } from "@langwatch/analytics-client";
import { defineBrowserModule } from "@langwatch/browser";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { InsightsBellToken, InsightsNavCountToken, insightTrpc } from "@langwatch/insight-contract";
import { LangyAnswerActionToken } from "@langwatch/langy-contract";

import { insightApi } from "./behavior/insight-api.ts";

export const insightWeb = defineBrowserModule("insight")
  .withApi(insightApi, { contracts: [insightTrpc] })
  .withHosts({
    requires: ["InsightHostApi"],
    mounts: { InsightHostApi: { load: () => import("./behavior/insight-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/insights": {
      path: "/:project/insights",
      within: "project",
      label: "Insights",
      flags: [FrontendFlags.release_insights],
      requires: "analytics:view",
      load: () => import("./ui/sections/insights.screen.tsx"),
    },
  })
  .lends(InsightsBellToken, {
    load: async () => ({
      default: (await import("./ui/sections/insights-bell.tsx")).InsightsBell,
    }),
  })
  .lends(InsightsNavCountToken, {
    load: async () => ({
      default: (await import("./ui/sections/insights-nav-count.tsx")).InsightsNavCount,
    }),
  })
  .lends(LangyAnswerActionToken, {
    load: async () => ({
      default: (await import("./ui/sections/save-as-insight-action.tsx")).SaveAsInsightAction,
    }),
  })
  .lends(BoardHeaderActionToken, {
    load: async () => ({
      default: (await import("./ui/sections/board-daily-insights.tsx")).BoardDailyInsights,
    }),
  });
