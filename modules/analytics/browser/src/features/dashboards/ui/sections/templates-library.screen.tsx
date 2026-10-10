/**
 * `/[project]/dashboards/templates`: the templates finder. A picked category turns the header
 * into its question and pitch; an agent-type chip shows only the templates made for that type.
 * Adding one makes a board for the whole project and drafts its report in Langy (AC140).
 */

import { Box, Button, Grid, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useId } from "react";

import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useBoardPeriod } from "../../behavior/use-board-period.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useTemplateLibraryFilters } from "../../behavior/use-template-library-filters.ts";
import { TRUNK_PITCHES, TRUNK_QUESTIONS, type Trunk } from "../../catalogue/index.ts";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import { boardPromptDraft, boardSubject } from "../../langy/model/board-langy.ts";
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
        <Heading as="h1" fontSize="19px" fontWeight="semibold" letterSpacing="tight">
          Dashboard templates
        </Heading>
        <Text maxWidth="560px" fontSize="13px" color="fg.muted">
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
        fontSize="12px"
        fontWeight="semibold"
        colorPalette={TRUNK_PALETTES[trunk]}
        color="colorPalette.fg"
      >
        <Icon size={12} strokeWidth={2.2} aria-hidden />
        {trunk}
      </Text>
      <Heading as="h1" fontSize="19px" fontWeight="semibold" letterSpacing="tight">
        {TRUNK_QUESTIONS[trunk]}
      </Heading>
      <Text maxWidth="560px" fontSize="13px" color="fg.muted">
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
        <Heading as="h2" id={headingId} fontSize="13px" fontWeight="semibold" color="fg">
          {section.key}
        </Heading>
        <Text fontSize="12px" color="fg.subtle" fontVariantNumeric="tabular-nums">
          {section.items.length}
        </Text>
      </Box>
      {/* Columns follow the page's own width: one on a phone, up to three on a wide screen. */}
      <Grid templateColumns="repeat(auto-fill, minmax(min(100%, 340px), 1fr))" gap={5}>
        {section.items.map(renderCard)}
      </Grid>
    </VStack>
  );
}

function TemplatesLibrary() {
  const { filters, setFilters, clearFilters } = useTemplateLibraryFilters();
  const saved = useSavedDashboards();
  const fromTemplate = useBoardFromTemplate();
  const langy = useLangyAsk();
  // The library's address carries no period, so this is the one a new board opens on.
  const { period } = useBoardPeriod();
  // The agent type picks the pool; the search and the category narrow it.
  const pool = finderPool({ agentKind: filters.agentKind });
  const shown = filterCatalogue({ items: pool, filters });
  const isFiltered = Boolean(filters.search || filters.trunk || filters.agentKind);

  const create = async ({ board: template }: LibraryTemplate) => {
    const created = await fromTemplate.createFromTemplate({
      template,
      existingNames: saved.boards.map(({ name }) => name),
    });
    if (!created || !langy.enabled || !template.reportPrompt) return;
    const board = boardSubject({ board: created, widgets: created.widgets });
    langy.ask(boardPromptDraft({ prompt: template.reportPrompt, board, period }));
  };
  const addedHref = ({ board }: LibraryTemplate) => {
    const dashboardId = boardFromTemplateId({ templateName: board.name, boards: saved.boards });
    return dashboardId && dashboardsPath({ projectSlug: saved.projectSlug, dashboardId });
  };
  const renderCard = (template: LibraryTemplate) => (
    <TemplateCard
      key={template.board.id}
      template={template}
      actions={
        <AddTemplateButton
          name={template.board.name}
          isCreating={fromTemplate.creatingId === template.board.id}
          addedHref={addedHref(template)}
          onCreate={() => void create(template)}
        />
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
          <Text fontSize="14px" color="fg.muted">
            No template matches your search and filters.
          </Text>
          {isFiltered && (
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear search and filters
            </Button>
          )}
        </VStack>
      ) : (
        templateSections({ templates: shown }).map((section) => (
          <TrunkSection key={section.key} section={section} renderCard={renderCard} />
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
