/**
 * `/[project]/dashboards/templates`: the templates finder, one ranked grid under "All". A category
 * turns the header into its question and pitch; an agent-type chip shows the templates made for
 * that type, adapted to it. Adding one makes a project board and drafts its report (AC140).
 */

import { Box, Button, Grid, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useId } from "react";

import { useAddTemplate } from "../../behavior/use-add-template.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useStoreProject } from "../../behavior/use-store-project.ts";
import { useTemplateLibraryFilters } from "../../behavior/use-template-library-filters.ts";
import { TRUNK_PITCHES, TRUNK_QUESTIONS, type Trunk } from "../../catalogue/index.ts";
import { boardFromTemplateId, dashboardsPath } from "../../model/boards.ts";
import { filterCatalogue, trunkCounts } from "../../model/catalogue-filter.ts";
import {
  finderPool,
  type LibraryTemplate,
  type TemplateSection,
  templateSections,
} from "../../model/template-library.ts";
import {
  AgentKindChips,
  CatalogueSearch,
  TRUNK_ICONS,
  TRUNK_PALETTES,
  TrunkChips,
} from "../blocks/catalogue-filters.tsx";
import { AddTemplateButton, TemplateCard } from "../blocks/template-card.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

/** All templates, or one category: its name, its question and what it is for. */
function FinderHeading({ trunk }: { trunk: Trunk | undefined }) {
  if (!trunk) {
    return (
      <VStack gap={1} textAlign="center">
        <Heading as="h1" textStyle="pageTitle">
          Dashboard templates
        </Heading>
        <Text maxWidth="560px" textStyle="bodySm" color="fg.muted">
          Each template answers one job with a ready-made dashboard you can edit.
        </Text>
      </VStack>
    );
  }
  const Icon = TRUNK_ICONS[trunk];
  return (
    <VStack gap={1} textAlign="center">
      <Text
        as="span"
        display="inline-flex"
        alignItems="center"
        gap={1}
        textStyle="caption"
        fontWeight="semibold"
        colorPalette={TRUNK_PALETTES[trunk]}
        color="colorPalette.fg"
      >
        <Icon size={12} strokeWidth={2.2} aria-hidden />
        {trunk}
      </Text>
      <Heading as="h1" textStyle="pageTitle">
        {TRUNK_QUESTIONS[trunk]}
      </Heading>
      <Text maxWidth="560px" textStyle="bodySm" color="fg.muted">
        {TRUNK_PITCHES[trunk]}
      </Text>
    </VStack>
  );
}

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
    return <TemplateGrid label="All templates" templates={templates} renderCard={renderCard} />;
  }
  return templateSections({ templates }).map((section) => (
    <TrunkSection key={section.key} section={section} renderCard={renderCard} />
  ));
}

/** "All": one grid, one template per job, most needed first, with no category headings. */
function TemplateGrid({
  label,
  templates,
  renderCard,
}: {
  label: string;
  templates: readonly LibraryTemplate[];
  renderCard: (template: LibraryTemplate) => ReactNode;
}) {
  return (
    <Box as="section" aria-label={label}>
      <CardGrid templates={templates} renderCard={renderCard} />
    </Box>
  );
}

/**
 * The finder. At the organization level (`/dashboards/templates`) a template is always added
 * anew to the store project, Only me and numbered, so no card reads "Added" (ADR-002).
 */
export function TemplatesLibrary({ atOrganization = false }: { atOrganization?: boolean }) {
  const { filters, setFilters, clearFilters } = useTemplateLibraryFilters();
  const saved = useSavedDashboards();
  const store = useStoreProject({ enabled: atOrganization });
  const fromTemplate = useAddTemplate({
    atOrganization,
    storeProject: store.storeProject,
    existingNames: atOrganization ? store.namesInStore : saved.boards.map(({ name }) => name),
  });
  // At the organization level a board is made Only me in the store project, so it needs both
  // grants there (ADR-002); with none, nothing makes a board.
  const offersAdd = !atOrganization || (store.storeProject !== void 0 && store.mayShare);
  // The agent type picks the pool; the search and the category narrow it.
  const pool = finderPool({ agentKind: filters.agentKind });
  const shown = filterCatalogue({ items: pool, filters });
  const isFiltered = Boolean(filters.search || filters.trunk || filters.agentKind);

  const addedHref = ({ board }: LibraryTemplate) => {
    if (atOrganization) return void 0;
    const dashboardId = boardFromTemplateId({
      templateNames: [board.name, ...(board.formerNames ?? [])],
      boards: saved.boards,
    });
    return dashboardId && dashboardsPath({ projectSlug: saved.projectSlug, dashboardId });
  };
  const renderCard = (template: LibraryTemplate) => (
    <TemplateCard
      key={template.board.id}
      template={template}
      actions={
        offersAdd ? (
          <AddTemplateButton
            name={template.board.name}
            isCreating={fromTemplate.creatingId === template.board.id}
            addedHref={addedHref(template)}
            inProject={!atOrganization}
            onCreate={() => void fromTemplate.add(template.board)}
          />
        ) : null
      }
    />
  );

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
      <VStack gap={6}>
        <FinderHeading trunk={filters.trunk} />
        <VStack gap={4} width="full">
          <CatalogueSearch
            placeholder="Search templates"
            value={filters.search}
            onChange={(search) => setFilters({ ...filters, search })}
          />
          <TrunkChips
            picked={filters.trunk}
            counts={trunkCounts({ items: pool, search: filters.search })}
            onPick={(trunk) => setFilters({ ...filters, trunk })}
          />
          <AgentKindChips
            picked={filters.agentKind}
            countOf={(agentKind) =>
              filterCatalogue({ items: finderPool({ agentKind }), filters }).length
            }
            onPick={(agentKind) => setFilters({ ...filters, agentKind })}
          />
        </VStack>
      </VStack>
      {shown.length === 0 ? (
        <VStack gap={3} paddingY={16}>
          <Text textStyle="body" color="fg.muted">
            No template matches your search and filters.
          </Text>
          {isFiltered && (
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear search and filters
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

export default function TemplatesLibraryScreen() {
  return (
    <DashboardsGate>
      <TemplatesLibrary />
    </DashboardsGate>
  );
}
