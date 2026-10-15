/** Insight's bell and unread pill, drawn where navigation places them (§10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { InsightsBellToken, InsightsNavCountToken } from "@langwatch/insight-contract";

/** The topbar bell; insight draws nothing without a project, its flag or the grant. */
export function InsightsBell() {
  return <Lent of={InsightsBellToken} props={{}} />;
}

/** The unread pill beside the sidebar's Insights entry; nothing at zero. */
export function InsightsNavCount() {
  return <Lent of={InsightsNavCountToken} props={{}} />;
}
