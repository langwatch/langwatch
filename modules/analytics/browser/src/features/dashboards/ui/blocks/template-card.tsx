/**
 * One template, as the blank board and the templates library both show it: a preview,
 * what the board is for, its trunk in the trunk's colour, and the agent kinds it suits.
 * A coming-soon template says how far it is built and cannot create a board yet.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  Image,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  Activity,
  DollarSign,
  FlaskConical,
  Gauge,
  type LucideIcon,
  Plus,
  TriangleAlert,
} from "lucide-react";

import { AGENT_KIND_LABELS, type Trunk } from "../../catalogue/index.ts";
import type { LibraryTemplate } from "../../model/template-library.ts";

/** One design-system palette per trunk, for the card accent, the trunk badge and the section. */
export const TRUNK_PALETTES: Readonly<Record<Trunk, string>> = {
  Profit: "green",
  Growth: "blue",
  Protect: "orange",
  Foundation: "purple",
};

export const TRUNK_ICONS: Readonly<Record<Trunk, LucideIcon>> = {
  Profit: DollarSign,
  Growth: Activity,
  Protect: TriangleAlert,
  Foundation: FlaskConical,
};

/** The Flight Deck's gauge; every other template takes its trunk's icon. */
const TEMPLATE_ICONS: Readonly<Partial<Record<string, LucideIcon>>> = { cockpit: Gauge };

/** One preview for every template; served from the app's public images. */
const TEMPLATE_PREVIEW_SRC = "/images/dashboards/template-preview.png";

export function TemplateCard({
  template,
  isCreating,
  onCreate,
}: {
  template: LibraryTemplate;
  isCreating: boolean;
  onCreate: () => void;
}) {
  const { board, trunk, agentKinds, widgetCount } = template;
  const Icon = TEMPLATE_ICONS[board.id] ?? TRUNK_ICONS[trunk];
  const progress = board.comingSoon;
  return (
    <VStack
      as="article"
      aria-label={board.name}
      colorPalette={TRUNK_PALETTES[trunk]}
      align="stretch"
      gap={3}
      padding={4}
      minWidth={0}
      borderWidth="1px"
      borderTopWidth="3px"
      borderColor="border"
      borderTopColor="colorPalette.solid"
      borderRadius="xl"
      background="bg.panel"
    >
      <Image
        src={TEMPLATE_PREVIEW_SRC}
        alt=""
        aria-hidden
        height="132px"
        width="full"
        objectFit="cover"
        objectPosition="top left"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        opacity={progress ? 0.6 : 1}
      />
      <VStack align="stretch" gap={1} minWidth={0}>
        <HStack gap={2} minWidth={0}>
          <Box color="colorPalette.fg" display="flex" flexShrink={0}>
            <Icon size={15} strokeWidth={2.1} aria-hidden />
          </Box>
          <Text as="h3" fontSize="14px" fontWeight="semibold" color="fg" truncate>
            {board.name}
          </Text>
          <Badge
            marginLeft="auto"
            flexShrink={0}
            variant="subtle"
            colorPalette={TRUNK_PALETTES[trunk]}
          >
            {trunk}
          </Badge>
        </HStack>
        <Text fontSize="12.5px" lineHeight="1.5" color="fg.muted" lineClamp={2}>
          {board.summary ?? board.description}
        </Text>
      </VStack>
      <HStack gap={1} wrap="wrap">
        {agentKinds.length === 0 ? (
          <Badge variant="outline" colorPalette="gray">
            Any agent
          </Badge>
        ) : (
          agentKinds.map((kind) => (
            <Badge key={kind} variant="outline" colorPalette="gray">
              {AGENT_KIND_LABELS[kind]}
            </Badge>
          ))
        )}
      </HStack>
      <HStack gap={2} marginTop="auto" paddingTop={1}>
        <Button
          size="sm"
          variant="solid"
          colorPalette="gray"
          aria-label={`Create a board from ${board.name}`}
          loading={isCreating}
          loadingText="Creating…"
          disabled={progress !== void 0}
          onClick={onCreate}
        >
          <Plus size={14} aria-hidden />
          Create board
        </Button>
        <Text marginLeft="auto" fontSize="11.5px" color="fg.subtle" textAlign="end">
          {progress
            ? `Coming soon: ${progress.built} of ${progress.total} widgets built`
            : `${widgetCount} widgets`}
        </Text>
      </HStack>
    </VStack>
  );
}
