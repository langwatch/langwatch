// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Boxes } from "lucide-react";
import type { ReactNode } from "react";

import { GovernanceEmptyState } from "~/components/governance/empty";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { SAMPLE_TOOL_CARDS } from "./sampleToolCards";
import { ToolCatalogCards, type ToolCatalogLayout } from "./ToolCatalogCards";
import {
  buildToolCards,
  type ToolCard,
  type ToolCardHealth,
  type ToolCardSource,
} from "./toolCards";

/**
 * The Catalog pane: every AI tool the organization has registered, as cards.
 *
 * The pane takes its cards rather than fetching them, because the page already
 * holds the source list for the Sources tab and the tab count, and a second
 * read of the same list would be a second spinner over the same rows.
 *
 * Sample mode REPLACES the cards; it never fills the real ones in. A reader
 * looking at a real card is looking at measurements or at dashes, with no
 * third state where the two are mixed.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/**
 * Which cards the pane shows.
 *
 * Exported and pure so the substitution rule is testable without a render: it
 * is the one place an invented figure could reach a real screen.
 */
export function catalogCards({
  sources,
  health,
  sampleActive,
}: {
  sources: readonly ToolCardSource[] | undefined;
  health: readonly ToolCardHealth[] | null | undefined;
  sampleActive: boolean;
}): ToolCard[] {
  if (sampleActive) return SAMPLE_TOOL_CARDS;
  return buildToolCards({ sources: sources ?? [], health });
}

export function ToolCatalogTab({
  canRead,
  sources,
  health,
  sampleActive,
  layout,
  canManage,
  addToolAction,
}: {
  /**
   * Whether the viewer may read the source list this pane is built from.
   *
   * Without it the list read is never issued, so an ungated pane would draw
   * its "no tools registered yet" empty state and tell a viewer their
   * organization runs no AI at all — a confident wrong answer where the honest
   * one is that they cannot see. The catalog's gate is the source list's
   * (`ingestionSources:view`), not the tiles' `aiTools:manage`: tiles left this
   * page, and what the pane reads now is the sources.
   */
  canRead: boolean;
  sources: readonly ToolCardSource[] | undefined;
  health: readonly ToolCardHealth[] | null | undefined;
  sampleActive: boolean;
  layout: ToolCatalogLayout;
  /**
   * Whether the reader may add a tool, which decides what the empty state SAYS.
   * A reader without the grant is never told to press something that is not on
   * their screen.
   */
  canManage: boolean;
  /**
   * The page header's own create control, rendered again inside the empty
   * state. It is the SAME component the header renders, so it carries one
   * label, one weight and one flow, which is what the create-on-top rule
   * actually asks for. The rule forbids a second, differently-worded door —
   * the outline "Add source" that used to sit in the sources table — not a
   * second way to reach the same one.
   */
  addToolAction?: ReactNode;
}) {
  if (!canRead) {
    return (
      <PermissionRequiredNotice
        permission="ingestionSources:view"
        detail="The catalog is built from the tools you have connected, so it stays hidden until then."
      />
    );
  }

  const cards = catalogCards({ sources, health, sampleActive });

  if (cards.length === 0) {
    return (
      <GovernanceEmptyState
        testId="tool-catalog-empty"
        icon={Boxes}
        headline="No tools registered yet"
        // The state and its reason, not a fault. The sentence says what fills
        // the catalog, because "no tools" alone reads as something broken on a
        // page whose whole job is to say what the organization runs.
        description={
          canManage
            ? "A tool joins the catalog when you connect it as a source, and appears here with its environment and what it has been spending."
            : "A tool joins the catalog when someone connects it as a source. Once one is connected it appears here with its environment and what it has been spending."
        }
        action={addToolAction}
      />
    );
  }

  return <ToolCatalogCards cards={cards} layout={layout} />;
}
