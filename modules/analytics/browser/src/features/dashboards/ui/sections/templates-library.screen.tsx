/**
 * `/[project]/dashboards/templates`: every dashboard template, searchable, narrowed by trunk,
 * agent kind and readiness in one quiet toolbar, and sectioned by trunk. "Create board" makes
 * a board from the template that only the member sees, and opens it.
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
import { CatalogueFilterBar, TRUNK_ICONS, TRUNK_PALETTES } from "../blocks/catalogue-filters.tsx";
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
      <HStack gap={2}>
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
        <Heading as="h2" id={headingId} fontSize="13px" fontWeight="semibold" color="fg">
          {section.key}
        </Heading>
        <Text fontSize="12px" color="fg.subtle" fontVariantNumeric="tabular-nums">
          {section.items.length}
        </Text>
      </HStack>
      <Grid
        templateColumns={{
          base: "minmax(0, 1fr)",
          md: "repeat(2, minmax(0, 1fr))",
          xl: "repeat(3, minmax(0, 1fr))",
        }}
        gap={5}
      >
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
      gap={8}
      width="full"
      maxWidth="1440px"
      marginX="auto"
      paddingX={{ base: 4, md: 8 }}
      paddingY={{ base: 5, md: 7 }}
    >
      <VStack align="stretch" gap={5}>
        <VStack align="stretch" gap={1}>
          <Heading as="h1" fontSize="19px" fontWeight="semibold" letterSpacing="tight">
            Dashboard templates
          </Heading>
          <Text fontSize="13px" color="fg.muted" maxWidth="680px">
            Each template answers one job with a ready-made dashboard you can edit and share.
          </Text>
        </VStack>
        <CatalogueFilterBar
          filters={filters}
          counts={counts}
          onChange={setFilters}
          leading={
            // A grid stretches the inline search group, so the whole placeholder shows.
            <Box display="grid" flex="1 1 240px" maxWidth={{ base: "full", md: "320px" }}>
              <SearchInput
                size="sm"
                aria-label="Search templates"
                placeholder="Search by name, question or agent kind"
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              />
            </Box>
          }
        />
      </VStack>
      {shown.length === 0 ? (
        <VStack gap={3} paddingY={16}>
          <Text fontSize="14px" color="fg.muted">
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
