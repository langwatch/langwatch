/**
 * What an empty board shows under its ask bar and suggested questions: "Or start from a template"
 * with every template, filtered by category and agent type, each filling this board when used.
 * The footer "Add a widget" stays only below a board's widgets.
 */

import { Box, Button, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";
import { useState } from "react";

import { type CatalogueFilters, NO_CATALOGUE_FILTERS } from "../../model/catalogue-filter.ts";
import type { BoardTemplate } from "../../templates/index.ts";
import { TemplateCard } from "./template-card.tsx";
import { TemplateGallery } from "./template-gallery.tsx";

/** The compact footer below a board's widgets, opening "Add a widget". */
export function AddBlockCard({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="plain"
      height="auto"
      width="full"
      flexDirection="column"
      gap={2}
      paddingX={6}
      paddingY={8}
      lineHeight="1.45"
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      borderRadius="2xl"
      color="fg.subtle"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "fg.subtle", color: "fg" }}
      onClick={onClick}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={10}
        borderRadius="full"
        background="bg.muted"
      >
        <Plus size={18} aria-hidden />
      </Box>
      <Text textStyle="body" fontWeight="medium">
        Add a widget
      </Text>
      <Text textStyle="bodySm" color="fg.subtle">
        Start from the question you need answered.
      </Text>
    </Button>
  );
}

/** "Use this template"; while one template is being used, the others wait. */
function UseTemplateButton({
  template,
  applyingId,
  onUse,
}: {
  template: BoardTemplate;
  applyingId: string | undefined;
  onUse: (template: BoardTemplate) => void;
}) {
  return (
    <Button
      size="sm"
      variant="solid"
      colorPalette="accent"
      aria-label={`Use ${template.name}`}
      loading={applyingId === template.id}
      loadingText="Adding…"
      disabled={applyingId !== void 0 && applyingId !== template.id}
      onClick={() => onUse(template)}
    >
      <Plus size={14} aria-hidden />
      Use this template
    </Button>
  );
}

export function EmptyBoard({
  applyingId,
  onUse,
}: {
  /** The template being put on this board, while one is. */
  applyingId: string | undefined;
  /** Fills this board from the template. */
  onUse: (template: BoardTemplate) => void;
}) {
  // Kept on the board, not in the address: the filters go with the gallery once a widget lands.
  const [filters, setFilters] = useState<CatalogueFilters>(NO_CATALOGUE_FILTERS);
  return (
    <VStack as="section" aria-label="Start from a template" align="stretch" gap={5}>
      <Heading as="h2" textStyle="cardTitle" textAlign="center">
        Or start from a template
      </Heading>
      <TemplateGallery
        filters={filters}
        onFiltersChange={setFilters}
        renderCard={(template) => (
          <TemplateCard
            key={template.board.id}
            template={template}
            actions={
              <UseTemplateButton template={template.board} applyingId={applyingId} onUse={onUse} />
            }
          />
        )}
      />
    </VStack>
  );
}
