/** Insight's bell, unread pill and entry rule, used where navigation places them (§10.1). */

import { Lent, useLentHooks } from "@langwatch/browser-host/lent";
import {
  type InsightsEntry,
  InsightsBellToken,
  InsightsEntryToken,
  InsightsNavCountToken,
} from "@langwatch/insight-contract";

const NO_INSIGHTS: InsightsEntry = { useIsShown: () => false };

/** The topbar bell; insight draws nothing without a project, its flag or the grant. */
export function InsightsBell() {
  return <Lent of={InsightsBellToken} props={{}} />;
}

/** The unread pill beside the sidebar's Insights entry; nothing at zero. */
export function InsightsNavCount() {
  return <Lent of={InsightsNavCountToken} props={{}} />;
}

/** Whether insight shows its side-menu entry, by the bell's own rule; false without insight. */
export function useInsightsEntryShown(): boolean {
  return (useLentHooks(InsightsEntryToken) ?? NO_INSIGHTS).useIsShown();
}
