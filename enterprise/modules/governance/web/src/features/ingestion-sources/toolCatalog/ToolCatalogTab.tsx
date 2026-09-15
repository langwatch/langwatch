// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HStack, Spinner, Text } from "@chakra-ui/react";
import { Boxes } from "lucide-react";
import type { ReactNode } from "react";

import { GovernanceEmptyState } from "../../../ui/elements/governance-empty-state.tsx";
import type { AiToolEntry } from "../../ai-tools/model/ai-tool-tile.ts";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";
import { HandledErrorAlert } from "../../../ui/elements/handled-error-alert.tsx";

import { asRegisteredTools, buildRegisteredToolCards } from "./registeredTools";
import { SAMPLE_TOOL_CARDS } from "./sampleToolCards";
import {
  type ToolCardActions,
  ToolCatalogCards,
  type ToolCatalogLayout,
} from "./ToolCatalogCards";
import type { ToolCard } from "./toolCards";

/**
 * The Catalog pane: every AI tool the organization has registered.
 *
 * IT READS THE TOOL REGISTRY, NOT THE SOURCE LIST. It used to derive a card
 * from each configured ingestion source, so an organization pulling billing
 * through an admin connector saw that connector listed as one of its tools.
 * A source is a pipe; the registry (`AiToolEntry`) is the list of tools, and
 * it is what an admin curates and what the personal portal already launches
 * from. Nothing joins the two here — the pane shows what was registered, and
 * a tool with no source simply has no measured figures yet, which every empty
 * row already says.
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
  tools,
  sampleActive,
}: {
  tools: readonly AiToolEntry[] | undefined;
  sampleActive: boolean;
}): ToolCard[] {
  if (sampleActive) return SAMPLE_TOOL_CARDS;
  return buildRegisteredToolCards({ tools: asRegisteredTools(tools) });
}

export function ToolCatalogTab({
  canManage,
  tools,
  isLoading,
  error,
  sampleActive,
  layout,
  addToolAction,
  renderActions,
}: {
  /**
   * Whether the viewer may manage the tool registry, which is also the grant
   * the pane's read needs.
   *
   * The catalog is the whole registry, published entries and unpublished ones
   * alike, because an inventory that hid the tools nobody can launch would
   * report a contract the organization is still paying for as one it does not
   * have. That list is the admin read (`aiTools:manage`); the per-member read
   * is scoped to the departments each person belongs to and would give two
   * readers two different inventories. So the pane is gated rather than
   * degraded: a reader without the grant is told which grant, with the tab
   * strip still in place, instead of being shown a partial estate as if it
   * were the whole one.
   */
  canManage: boolean;
  tools: readonly AiToolEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
  sampleActive: boolean;
  layout: ToolCatalogLayout;
  /**
   * The page header's own create control, rendered again inside the empty
   * state. It is the SAME component the header renders, so it carries one
   * label, one weight and one flow, which is what the create-on-top rule
   * actually asks for. The rule forbids a second, differently-worded door,
   * not a second way to reach the same one.
   */
  addToolAction?: ReactNode;
  /** The per-tool overflow menu, when the reader may act on the tool. */
  renderActions?: ToolCardActions;
}) {
  if (!canManage) {
    return (
      <PermissionRequiredNotice
        permission="aiTools:manage"
        detail="The catalog is the organization's whole tool registry, so it stays hidden until then."
      />
    );
  }

  // Sample mode answers from its own list, so neither the read's spinner nor
  // its failure is the reader's problem while it is on — the banner above has
  // already said nothing on screen is real.
  if (!sampleActive && isLoading) {
    return (
      <HStack padding={6} justifyContent="center" gap={2}>
        <Spinner size="sm" />
        <Text fontSize="sm" color="fg.muted">
          Loading the catalog…
        </Text>
      </HStack>
    );
  }

  if (!sampleActive && error) {
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load the tool catalog"
      />
    );
  }

  const cards = catalogCards({ tools, sampleActive });

  if (cards.length === 0) {
    return (
      <GovernanceEmptyState
        testId="tool-catalog-empty"
        icon={Boxes}
        headline="No tools registered yet"
        // The state and its reason, not a fault. The sentence says what fills
        // the catalog, because "no tools" alone reads as something broken on a
        // page whose whole job is to say what the organization runs.
        description="Register the AI tools this organization runs and they appear here with what they cost and who uses them."
        action={addToolAction}
      />
    );
  }

  return (
    <ToolCatalogCards
      cards={cards}
      layout={layout}
      renderActions={renderActions}
    />
  );
}
