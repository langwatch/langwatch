/** Insight's bell and unread pill: the tokens insight lends by and the ready components (§10.1). */

import { lentComponent } from "@langwatch/browser-host/lent";
import { uiTokens } from "@langwatch/module";

export type InsightsBellProps = Record<string, never>;

/** The topbar bell with its unread pill and popover (§10.1); draws nothing without a project. */
export const InsightsBellToken = uiTokens("insight").component<InsightsBellProps>("insightsBell");

export type InsightsNavCountProps = Record<string, never>;

/** The unread pill beside the sidebar's Insights entry; draws nothing at zero. */
export const InsightsNavCountToken =
  uiTokens("insight").component<InsightsNavCountProps>("insightsNavCount");

/** The topbar bell; insight draws nothing without a project, its flag or the grant. */
export const InsightsBell = lentComponent(InsightsBellToken);

/** The unread pill beside the sidebar's Insights entry; nothing at zero. */
export const InsightsNavCount = lentComponent(InsightsNavCountToken);
