/**
 * The two lists an overview carries while the section has nothing of its own:
 * the insights a governance admin would come back for, and the trail of screens
 * they were last on.
 *
 * Invented, and marked as such by the `sample` badge each list carries beside
 * its own label. They exist because an empty overview teaches nothing about
 * ANATOMY: a reader who has connected no source cannot tell what an insight
 * will look like when one arrives, only that there are none. These rows show
 * the shape — an insight is a severity, a headline and a date; a recent item is
 * a mark, a name and the kind of thing it was.
 *
 * They live in their own module rather than inside the component that draws
 * them, for the same reason the Costs lanes, the People rows and the tool cards
 * do: invented content is the part of a page most likely to be rewritten by
 * somebody who is not touching the layout, and one file per page's fiction is
 * what makes that a small change. `~/components/governance/sample` holds the
 * shared machinery — the one choice, its toggle and its banner — and never the
 * content, which is different on every page.
 *
 * One section, one fiction: the department here is Engineering, the first of
 * the invented departments the People page's samples use, so a reader moving
 * between the two screens is not asked to work out whether they are being shown
 * two different make-believe companies.
 *
 * Nothing here is a measurement. The insights are written as findings rather
 * than figures, because a bare number on this page is the one thing a reader
 * might mistake for their own.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature,
 * specs/ai-governance/dashboard/governance-ui-controls.feature
 */

import type { LucideIcon } from "lucide-react";
import { Bot, Coins, Inbox, PackageOpen, Users } from "lucide-react";

/** Where the insights list and its own sample rows both point. */
export const INSIGHTS_HREF = "/governance/insights";

/**
 * The three readings an insight can carry, as our own palettes rather than
 * flat blocks of colour: the same green, amber and red the rest of the product
 * uses for the same three meanings.
 */
export const SEVERITIES = {
  warning: { label: "Warning", palette: "red" },
  look: { label: "Worth a look", palette: "orange" },
  good: { label: "Good news", palette: "green" },
} as const;

export type Severity = keyof typeof SEVERITIES;

export interface SampleInsight {
  severity: Severity;
  headline: string;
  date: string;
}

/**
 * Most pressing first, which is the order this list will be built in when it is
 * real.
 */
export const SAMPLE_INSIGHTS: ReadonlyArray<SampleInsight> = [
  {
    severity: "warning",
    headline:
      "Three registered agents have run without a named owner since May.",
    date: "Yesterday",
  },
  {
    severity: "look",
    headline:
      "Assistant spend rose 18% this month, nearly all of it in one department.",
    date: "Aug 2",
  },
  {
    severity: "good",
    headline: "Unused Copilot seats fell to 4% after the June clean-up.",
    date: "Jul 28",
  },
];

export interface SampleActivityRow {
  name: string;
  kind: string;
  href: string;
  icon: LucideIcon;
  /**
   * Marks a destination only offered to an organization holding the billed-cost
   * flag. A sample row is still a link, and a link to a page the reader's own
   * guard would refuse is worse than one row fewer.
   */
  ridesInsightsFlag?: boolean;
}

/**
 * Each row names a thing and, on the right, the kind of thing it was. The name
 * alone is not enough to place "Engineering" or "Monthly review", and the kind
 * is what tells the reader which screen they are going back to.
 */
export const SAMPLE_ACTIVITY: ReadonlyArray<SampleActivityRow> = [
  {
    name: "Spend by department",
    kind: "Costs",
    href: "/governance/costs",
    icon: Coins,
    ridesInsightsFlag: true,
  },
  {
    name: "Engineering",
    kind: "Directory",
    href: "/governance/people",
    icon: Users,
  },
  {
    name: "Anthropic admin",
    kind: "Sources",
    href: "/governance/inventory?tab=sources",
    icon: PackageOpen,
  },
  {
    name: "Release notes bot",
    kind: "Agents",
    href: "/governance/agents",
    icon: Bot,
  },
  {
    name: "Monthly review",
    kind: "Dashboard",
    href: INSIGHTS_HREF,
    icon: Inbox,
    ridesInsightsFlag: true,
  },
];
