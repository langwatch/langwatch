// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box, Text, VStack } from "@chakra-ui/react";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";

import { ToolCatalogCards, type ToolCatalogLayout } from "./ToolCatalogCards";
import {
  buildToolCards,
  SAMPLE_TOOL_CARDS,
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
      <Box
        data-testid="tool-catalog-empty"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={8}
        textAlign="center"
      >
        <VStack gap={1}>
          <Text fontSize="sm" fontWeight="medium">
            No tools registered yet
          </Text>
          <Text fontSize="sm" color="fg.muted" maxWidth="440px">
            A tool joins the catalog when you connect it as a source. Add one
            with the button above, or turn on sample data to see what the
            catalog holds once tools are reporting.
          </Text>
        </VStack>
      </Box>
    );
  }

  return <ToolCatalogCards cards={cards} layout={layout} />;
}
