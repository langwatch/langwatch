/**
 * A board with nothing on it yet: the "Start from a template" grid, which makes a new
 * board from any built template. The dashed "Add a block" target stays only as the
 * compact footer on a non-empty board.
 */

import { Box, Button, Grid, Text, VStack } from "@chakra-ui/react";
import {
  Activity,
  DollarSign,
  FlaskConical,
  Gauge,
  type LucideIcon,
  Plus,
  TriangleAlert,
} from "lucide-react";

import type { BoardTemplateId, TemplateProgress } from "../../templates/index.ts";

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

/** A template as its card shows it. */
export interface TemplateCard {
  readonly id: BoardTemplateId;
  readonly name: string;
  readonly description: string;
  /** A user-facing line for what the board shows; falls back to `description`. */
  readonly summary?: string;
  /** The question-tree trunk the template serves; picks its icon. */
  readonly trunk?: string;
  /** Set while some of its widgets have no code: shown, and cannot be made yet. */
  readonly comingSoon?: TemplateProgress;
}

/** The Flight Deck's gauge; every other template takes its trunk's icon. */
const TEMPLATE_ICONS: Readonly<Partial<Record<BoardTemplateId, LucideIcon>>> = { cockpit: Gauge };

const TRUNK_ICONS: Readonly<Partial<Record<string, LucideIcon>>> = {
  Profit: DollarSign,
  Growth: Activity,
  Protect: TriangleAlert,
  Foundation: FlaskConical,
};

function TemplateButton({
  template,
  isCreating,
  onOpen,
}: {
  template: TemplateCard;
  isCreating: boolean;
  onOpen: () => void;
}) {
  const Icon = TEMPLATE_ICONS[template.id] ?? TRUNK_ICONS[template.trunk ?? ""] ?? Gauge;
  const progress = template.comingSoon;
  const subtitle = progress
    ? `Coming soon: ${progress.built} of ${progress.total} widgets built`
    : (template.summary ?? template.description);
  return (
    <Button
      variant="outline"
      height="auto"
      justifyContent="flex-start"
      gap={3}
      paddingX={4}
      paddingY={3}
      borderRadius="xl"
      borderColor="border"
      background="bg.panel"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.03)"
      fontWeight="normal"
      minWidth={0}
      overflow="hidden"
      title={template.description}
      _hover={{
        borderColor: "teal.solid/50",
        background: "bg.panel",
        boxShadow: "0 2px 8px rgb(16 16 32 / 0.06)",
      }}
      loading={isCreating}
      loadingText={`Creating ${template.name}…`}
      disabled={progress !== void 0}
      onClick={onOpen}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={8}
        flexShrink={0}
        borderRadius="md"
        background="bg.muted"
        color="teal.solid"
      >
        <Icon size={16} strokeWidth={2.1} aria-hidden />
      </Box>
      <VStack align="start" gap={0} minWidth={0} flex="1">
        <Text fontSize="13px" lineHeight="1.375" fontWeight="medium" color="fg" truncate>
          {template.name}
        </Text>
        <Text fontSize="12px" lineHeight="1.625" color="fg.subtle" lineClamp={2}>
          {subtitle}
        </Text>
      </VStack>
    </Button>
  );
}

export function TemplateStrip<Template extends TemplateCard>({
  templates,
  creatingId,
  onOpen,
}: {
  templates: readonly Template[];
  /** The template a board is being made from; its card shows it is busy. */
  creatingId: BoardTemplateId | undefined;
  onOpen: (template: Template) => void;
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
      <Grid templateColumns="repeat(auto-fill, minmax(260px, 1fr))" gap={2}>
        {templates.map((template) => (
          <TemplateButton
            key={template.id}
            template={template}
            isCreating={creatingId === template.id}
            onOpen={() => onOpen(template)}
          />
        ))}
      </Grid>
    </VStack>
  );
}

/** Everything a blank board shows under its header. */
export function BlankBoard<Template extends TemplateCard>({
  templates,
  creatingTemplateId,
  onOpenTemplate,
}: {
  templates: readonly Template[];
  creatingTemplateId: BoardTemplateId | undefined;
  onOpenTemplate: (template: Template) => void;
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
