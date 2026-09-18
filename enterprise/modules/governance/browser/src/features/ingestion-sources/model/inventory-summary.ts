// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceSummaryBarItem } from "../../../ui/elements/governance-summary-bar.tsx";
import type { ToolCard } from "../toolCatalog/toolCards.ts";

/**
 * The Inventory's resume strip: one figure per tab, above the tabs.
 *
 * WHY IT SITS ABOVE THE TABS. The three panes answer three halves of one
 * question — what does this organization run — and a reader had to open each
 * pane to learn how much was in it. The strip answers all three at once, which
 * is also why the Sources pane no longer carries its own "2 sources · 1
 * active" heading: that sentence is now up here, said once, beside its two
 * peers.
 *
 * EVERY FIGURE IS COUNTED FROM WHAT THE PAGE ALREADY HOLDS. Nothing here is
 * estimated and nothing is a placeholder. A count the page could not read —
 * because the query failed, is still in flight, or the reader lacks the grant
 * — arrives as `null` and the strip draws an em dash. Zero is a measurement
 * and would be a different claim entirely: "you run no tools" is not the same
 * sentence as "we could not tell you".
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 *
 * Ported from `platform/app/ee/governance/dashboard/logic/inventorySummary.ts`.
 */

/** English plural for the counts this strip hints with. */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * How many distinct vendors the catalog spans.
 *
 * The interesting number beside a tool count: eight tools from two vendors is
 * a consolidated estate, eight from seven is a procurement problem. Counted
 * off the cards rather than the registry rows so the sample catalog gets a
 * true figure too.
 */
export function vendorCount(cards: readonly ToolCard[]): number {
  return new Set(cards.map((card) => card.vendor)).size;
}

export function inventorySummaryItems({
  cards,
  environmentCount,
  discoveredEnvironmentCount,
  sourceCount,
  activeSourceCount,
}: {
  /** The catalog's cards, or null when the reader cannot see the registry. */
  cards: readonly ToolCard[] | null;
  /**
   * Null while the source list is loading or failed.
   *
   * Environments are DERIVED from that same list, so they inherit its
   * unreadability. An unanswered read makes the derivation return an empty
   * array, and counting that would have put "0 environments" next to a dashed
   * source count — the same read, answered two different ways, with the
   * environments half stating a measurement it does not have.
   */
  environmentCount: number | null;
  /** Environments derived from a source, as opposed to typed in by hand. */
  discoveredEnvironmentCount: number | null;
  /** Null while the source list is loading or failed. */
  sourceCount: number | null;
  activeSourceCount: number | null;
}): GovernanceSummaryBarItem[] {
  return [
    {
      key: "tools",
      value: cards ? cards.length : null,
      label: cards?.length === 1 ? "tool" : "tools",
      hint: cards ? plural(vendorCount(cards), "vendor") : undefined,
    },
    {
      key: "environments",
      value: environmentCount,
      label: environmentCount === 1 ? "environment" : "environments",
      hint:
        discoveredEnvironmentCount === null
          ? undefined
          : `${discoveredEnvironmentCount} discovered from your sources`,
    },
    {
      key: "sources",
      value: sourceCount,
      label: sourceCount === 1 ? "source" : "sources",
      hint: activeSourceCount === null ? undefined : `${activeSourceCount} active`,
    },
  ];
}
