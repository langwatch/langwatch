/**
 * `/[project]/dashboards/templates`: the templates finder, one ranked grid under "All". A category
 * turns the header into its question and pitch; an agent-type chip shows the templates made for
 * that type, adapted to it. Adding one makes a new project board and drafts its report (AC140).
 */

import { Heading, Text, VStack } from "@langwatch/design-system/primitives";

import { useAddTemplate } from "../../behavior/use-add-template.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useStoreProject } from "../../behavior/use-store-project.ts";
import { useTemplateLibraryFilters } from "../../behavior/use-template-library-filters.ts";
import { TRUNK_PITCHES, TRUNK_QUESTIONS, type Trunk } from "../../catalogue/index.ts";
import { boardFromTemplateId, dashboardsPath } from "../../model/boards.ts";
import type { LibraryTemplate } from "../../model/template-library.ts";
import { TRUNK_ICONS, TRUNK_PALETTES } from "../blocks/catalogue-filters.tsx";
import { AddTemplateButton, TemplateCard } from "../blocks/template-card.tsx";
import { TemplateGallery } from "../blocks/template-gallery.tsx";
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

/**
 * The finder. At the organization level (`/dashboards/templates`) a template is always added
 * anew to the store project, Only me and numbered, so no card reads "Added" (ADR-002).
 */
export function TemplatesLibrary({ atOrganization = false }: { atOrganization?: boolean }) {
  const { filters, setFilters } = useTemplateLibraryFilters();
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
      gap={6}
      width="full"
      maxWidth="1440px"
      marginX="auto"
      paddingX={{ base: 4, md: 8 }}
      paddingY={{ base: 5, md: 7 }}
    >
      <FinderHeading trunk={filters.trunk} />
      <TemplateGallery filters={filters} onFiltersChange={setFilters} renderCard={renderCard} />
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
