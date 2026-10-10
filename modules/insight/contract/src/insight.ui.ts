/**
 * What insight lends the shell (§10.1): the topbar bell and the sidebar entry's unread pill.
 * Both read the inbox themselves, so the shell hands them nothing.
 */

import { uiTokens } from "@langwatch/module";

export type InsightsBellProps = Record<string, never>;

/** The topbar bell with its unread pill and popover; draws nothing without a project in scope. */
export const InsightsBellToken = uiTokens("insight").component<InsightsBellProps>("insightsBell");

export type InsightsNavCountProps = Record<string, never>;

/** The unread pill beside the sidebar's Insights entry; draws nothing at zero. */
export const InsightsNavCountToken =
  uiTokens("insight").component<InsightsNavCountProps>("insightsNavCount");
