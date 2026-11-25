/**
 * The unread pill beside the sidebar's Insights entry, lent through `InsightsNavCountToken`:
 * green when the unseen news skews good, red otherwise; nothing at zero.
 */

import type { InsightsNavCountProps } from "@langwatch/insight-contract";

import { useInsightInbox } from "../../behavior/use-insight-inbox.ts";
import { UnreadPill } from "../elements/unread-pill.tsx";

export function InsightsNavCount(_props: InsightsNavCountProps) {
  const { available, inbox } = useInsightInbox();
  if (!available || !inbox) return null;
  return <UnreadPill count={inbox.count} tone={inbox.tone} />;
}
