/**
 * Every template as cards under the category and agent-type chips: one ranked grid under "All",
 * a picked category's own section otherwise. The templates finder and an empty board draw the
 * same one; each says what a card's button does.
 */

import { Box, Button, Grid, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useId } from "react";

import {
  type CatalogueFilters,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
  trunkCounts,
} from "../../model/catalogue-filter.ts";
import {
  finderPool,
  type LibraryTemplate,
  type TemplateSection,
  templateSections,
} from "../../model/template-library.ts";
import { AgentKindChips, TRUNK_ICONS, TRUNK_PALETTES, TrunkChips } from "./catalogue-filters.tsx";

function TrunkSection({
  section,
  renderCard,
}: {
  section: TemplateSection;
  renderCard: (template: LibraryTemplate) => ReactNode;
}) {
  const headingId = useId();
  const Icon = TRUNK_ICONS[section.key];
  return (
    <VStack as="section" aria-labelledby={headingId} align="stretch" gap={3}>
      <Box display="flex" alignItems="center" gap={2}>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize={5}
          borderRadius="md"
          colorPalette={TRUNK_PALETTES[section.key]}
          background="colorPalette.subtle"
          color="colorPalette.fg"
        >
          <Icon size={12} strokeWidth={2.2} aria-hidden />
        </Box>
        <Heading as="h2" id={headingId} textStyle="cardTitle" color="fg">
          {section.key}
        </Heading>
        <Text textStyle="caption" color="fg.subtle" fontVariantNumeric="tabular-nums">
          {section.items.length}
        </Text>
      </Box>
      <CardGrid templates={section.items} renderCard={renderCard} />
    </VStack>
  );
}

/** Columns follow the page's own width: one on a phone, up to three on a wide screen. */
function CardGrid({
  templates,
  renderCard,
}: {
  templates: readonly LibraryTemplate[];
  renderCard: (template: LibraryTemplate) => ReactNode;
}) {
  return (
    <Grid templateColumns="repeat(auto-fill, minmax(min(100%, 340px), 1fr))" gap={5}>
      {templates.map(renderCard)}
    </Grid>
  );
}

/** A picked category's section, or under "All" one grid with no headings. */
function TemplateResults({
  templates,
  byTrunk,
  renderCard,
}: {
  templates: readonly LibraryTemplate[];
  byTrunk: boolean;
  renderCard: (template: LibraryTemplate) => ReactNode;
}) {
  if (!byTrunk) {
    return (
      <Box as="section" aria-label="All templates">
        <CardGrid templates={templates} renderCard={renderCard} />
      </Box>
    );
  }
  return templateSections({ templates }).map((section) => (
    <TrunkSection key={section.key} section={section} renderCard={renderCard} />
  ));
}

export function TemplateGallery({
  filters,
  onFiltersChange,
  renderCard,
}: {
  filters: CatalogueFilters;
  onFiltersChange: (next: CatalogueFilters) => void;
  /** One template's card, with the button this surface gives it. */
  renderCard: (template: LibraryTemplate) => ReactNode;
}) {
  // The agent type picks the pool; the category narrows it.
  const pool = finderPool({ agentKind: filters.agentKind });
  const shown = filterCatalogue({ items: pool, filters });
  const isFiltered = Boolean(filters.trunk || filters.agentKind);
  return (
    <VStack align="stretch" gap={8} width="full">
      <VStack gap={4} width="full">
        <TrunkChips
          picked={filters.trunk}
          counts={trunkCounts({ items: pool, search: filters.search })}
          onPick={(trunk) => onFiltersChange({ ...filters, trunk })}
        />
        <AgentKindChips
          picked={filters.agentKind}
          countOf={(agentKind) =>
            filterCatalogue({ items: finderPool({ agentKind }), filters }).length
          }
          onPick={(agentKind) => onFiltersChange({ ...filters, agentKind })}
        />
      </VStack>
      {shown.length === 0 ? (
        <VStack gap={3} paddingY={16}>
          <Text textStyle="body" color="fg.muted">
            No template matches these filters.
          </Text>
          {isFiltered && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onFiltersChange(NO_CATALOGUE_FILTERS)}
            >
              Clear filters
            </Button>
          )}
        </VStack>
      ) : (
        <TemplateResults
          templates={shown}
          byTrunk={Boolean(filters.trunk)}
          renderCard={renderCard}
        />
      )}
    </VStack>
  );
}
