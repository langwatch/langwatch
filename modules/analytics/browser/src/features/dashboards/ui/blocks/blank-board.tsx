/**
 * A board with nothing on it yet: the "Start from a template" grid, which makes a new
 * board from any built template. The dashed "Add a block" target stays only as the
 * compact footer on a non-empty board.
 */

import { Box, Button, Grid, Text, VStack } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

import type { LibraryTemplate } from "../../model/template-library.ts";
import type { BoardTemplateId } from "../../templates/index.ts";
import { TemplateCard } from "./template-card.tsx";

/** The compact footer below a board's widgets, opening the question picker. */
export function AddBlockCard({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <Button
      variant="plain"
      height="auto"
      width="full"
      flexDirection="column"
      gap={2}
      paddingX={6}
      paddingY={compact ? 8 : 16}
      lineHeight="1.45"
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized/80"
      borderRadius="2xl"
      color="gray.400"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "teal.solid/60", color: "teal.solid" }}
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
      <Text fontSize="14px" fontWeight="medium">
        Add a block
      </Text>
      <Text fontSize="12.5px" color="fg.subtle">
        Start from the question you need answered.
      </Text>
    </Button>
  );
}

function TemplateStrip({
  templates,
  creatingId,
  onOpen,
}: {
  templates: readonly LibraryTemplate[];
  /** The template a board is being made from; its card shows it is busy. */
  creatingId: BoardTemplateId | undefined;
  onOpen: (template: LibraryTemplate) => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <Text
        paddingX={1}
        fontSize="10.5px"
        fontWeight="semibold"
        letterSpacing="0.09em"
        textTransform="uppercase"
        color="gray.400"
      >
        Start from a template
      </Text>
      <Grid templateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={3}>
        {templates.map((template) => (
          <TemplateCard
            key={template.board.id}
            template={template}
            isCreating={creatingId === template.board.id}
            onCreate={() => onOpen(template)}
          />
        ))}
      </Grid>
    </VStack>
  );
}

/** Everything a blank board shows under its header. */
export function BlankBoard({
  templates,
  creatingTemplateId,
  onOpenTemplate,
}: {
  templates: readonly LibraryTemplate[];
  creatingTemplateId: BoardTemplateId | undefined;
  onOpenTemplate: (template: LibraryTemplate) => void;
}) {
  return (
    <VStack align="stretch" gap={5}>
      <TemplateStrip
        templates={templates}
        creatingId={creatingTemplateId}
        onOpen={onOpenTemplate}
      />
    </VStack>
  );
}
