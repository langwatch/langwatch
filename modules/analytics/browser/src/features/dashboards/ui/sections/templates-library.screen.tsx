/**
 * `/[project]/dashboards/templates`: every dashboard template, searchable, narrowed by
 * trunk, agent kind and readiness, and sectioned by trunk. "Create board" makes the same
 * board picking the template on a blank board makes.
 */

import {
  Box,
  Button,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { useId } from "react";

import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useTemplateLibraryFilters } from "../../behavior/use-template-library-filters.ts";
import {
  type CatalogueFilterPick,
  type CatalogueFilters,
  catalogueChipCounts,
  filterCatalogue,
  toggleCatalogueFilter,
} from "../../model/catalogue-filter.ts";
import {
  type LibraryTemplate,
  TEMPLATE_LIBRARY,
  type TemplateSection,
  templateSections,
} from "../../model/template-library.ts";
import {
  CatalogueFilterChips,
  TRUNK_ICONS,
  TRUNK_PALETTES,
} from "../blocks/catalogue-filter-chips.tsx";
import { TemplateCard } from "../blocks/template-card.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function TrunkSection({
  section,
  creatingId,
  onCreate,
  filters,
  onFilter,
}: {
  section: TemplateSection;
  creatingId: string | undefined;
  onCreate: (template: LibraryTemplate) => void;
  filters: CatalogueFilters;
  onFilter: (pick: CatalogueFilterPick) => void;
}) {
  const headingId = useId();
  const Icon = TRUNK_ICONS[section.key];
  return (
    <VStack as="section" aria-labelledby={headingId} align="stretch" gap={3}>
      <HStack gap={2} colorPalette={TRUNK_PALETTES[section.key]} color="colorPalette.fg">
        <Icon size={15} strokeWidth={2.1} aria-hidden />
        <Heading
          as="h2"
          id={headingId}
          fontSize="14px"
          fontWeight="semibold"
          color="colorPalette.fg"
        >
          {section.key}
        </Heading>
        <Text fontSize="12px" color="fg.subtle">
          {section.items.length}
        </Text>
      </HStack>
      <Grid templateColumns={{ base: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={4}>
        {section.items.map((template) => (
          <TemplateCard
            key={template.board.id}
            template={template}
            isCreating={creatingId === template.board.id}
            onCreate={() => onCreate(template)}
            filters={filters}
            onFilter={onFilter}
          />
        ))}
      </Grid>
    </VStack>
  );
}

function TemplatesLibrary() {
  const { filters, setFilters, clearFilters } = useTemplateLibraryFilters();
  const saved = useSavedDashboards();
  const fromTemplate = useBoardFromTemplate();
  const shown = filterCatalogue({ items: TEMPLATE_LIBRARY, filters });
  const counts = catalogueChipCounts({ items: TEMPLATE_LIBRARY, filters });
  const create = ({ board }: LibraryTemplate) =>
    void fromTemplate.createFromTemplate({
      template: board,
      existingNames: saved.boards.map(({ name }) => name),
    });

  return (
    <VStack
      align="stretch"
      gap={6}
      width="full"
      maxWidth="1440px"
      marginX="auto"
      paddingX={8}
      paddingY={6}
    >
      <VStack align="stretch" gap={1}>
        <Heading as="h1" fontSize="19px" fontWeight="semibold" letterSpacing="tight">
          Dashboard templates
        </Heading>
        <Text fontSize="12.5px" color="fg.muted" maxWidth="680px">
          Each template answers one job with a ready-made dashboard you can edit and share.
        </Text>
      </VStack>
      <VStack align="stretch" gap={2}>
        {/* A grid stretches the inline search group, so the whole placeholder shows. */}
        <Box display="grid" width="full" maxWidth="420px">
          <SearchInput
            size="sm"
            aria-label="Search templates"
            placeholder="Search by name, question or agent kind"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </Box>
        <CatalogueFilterChips filters={filters} counts={counts} onChange={setFilters} />
      </VStack>
      {shown.length === 0 ? (
        <VStack align="start" gap={2} paddingY={8}>
          <Text fontSize="14px" color="fg">
            No template matches your search and filters.
          </Text>
          <Button size="sm" variant="outline" onClick={clearFilters}>
            Clear search and filters
          </Button>
        </VStack>
      ) : (
        templateSections({ templates: shown }).map((section) => (
          <TrunkSection
            key={section.key}
            section={section}
            creatingId={fromTemplate.creatingId}
            onCreate={create}
            filters={filters}
            onFilter={(pick) => setFilters(toggleCatalogueFilter({ filters, pick }))}
          />
        ))
      )}
    </VStack>
  );
}

export default function TemplatesLibraryScreen() {
  return (
    <DashboardsGate>
      <TemplatesLibrary />
    </DashboardsGate>
  );
}
