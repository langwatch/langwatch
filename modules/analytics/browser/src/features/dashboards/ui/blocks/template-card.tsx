/**
 * One template: its name, its job, a preview of its board with its widget count on it, then a
 * footer of the surface's actions, a focus template's agent type and its category badge. With
 * no actions the badges sit over the preview. Cards carry no data status.
 */

import {
  Box,
  Button,
  HStack,
  Text,
  VisuallyHidden,
  VStack,
} from "@langwatch/design-system/primitives";
import { Bot, Check, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import { AGENT_KIND_CHIP_LABELS } from "../../catalogue/index.ts";
import type { LibraryTemplate } from "../../model/template-library.ts";
import { TRUNK_ICONS, TRUNK_PALETTES } from "./catalogue-filters.tsx";
import { TemplatePreview } from "./template-preview.tsx";

export function TemplateCard({
  template,
  actions,
}: {
  template: LibraryTemplate;
  /** What this surface lets the member do with the template, such as add it. */
  actions?: ReactNode;
}) {
  const { board, focusKind, widgetCount, preview, trunk } = template;
  return (
    <VStack
      as="article"
      aria-label={board.name}
      data-template={board.id}
      align="stretch"
      gap={3}
      width="full"
      height="full"
      minWidth={0}
      padding={4}
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
    >
      <VStack align="stretch" gap={1} minWidth={0}>
        <Text as="h3" fontSize="15px" lineHeight="20px" fontWeight="semibold" lineClamp={2}>
          {board.name}
        </Text>
        {/* Two lines kept even for a short job, so previews line up across a row. */}
        <Text fontSize="13px" lineHeight="20px" minHeight="40px" color="fg.muted" lineClamp={2}>
          {board.summary ?? board.description}
        </Text>
      </VStack>
      {/* With no actions the card is itself the link, so a footer would be an empty row: its
          badges then sit over the preview beside the widget count. */}
      <Box position="relative" marginTop="auto">
        <TemplatePreview preview={preview} />
        <HStack position="absolute" right={2} bottom={2} gap={1.5}>
          {!actions && <TemplateBadges trunk={trunk} focusKind={focusKind} onImage />}
          <Text {...PILL} fontWeight="medium">
            {widgetCount} widgets
          </Text>
        </HStack>
      </Box>
      {actions && (
        // One row on every card, so the actions sit level across a row.
        <HStack minHeight="32px" minWidth={0} justify="space-between" gap={3}>
          <HStack gap={2} flexShrink={0}>
            {actions}
          </HStack>
          <TemplateBadges trunk={trunk} focusKind={focusKind} />
        </HStack>
      )}
    </VStack>
  );
}

/** A small label over the preview image, so it reads on any capture. */
const PILL = {
  borderRadius: "full",
  borderWidth: "1px",
  borderColor: "border",
  background: "bg.panel",
  paddingX: 2,
  paddingY: 0.5,
  fontSize: "11px",
  lineHeight: "16px",
  color: "fg.muted",
  boxShadow: "xs",
} as const;

/** A focus template's agent type, then its category in the far right corner. */
function TemplateBadges({
  trunk,
  focusKind,
  onImage = false,
}: {
  trunk: LibraryTemplate["trunk"];
  focusKind?: LibraryTemplate["focusKind"];
  /** Over the preview, the agent type wears a pill so it reads on the image. */
  onImage?: boolean;
}) {
  return (
    <HStack gap={2} minWidth={0} fontSize="12px" lineHeight="20px">
      {focusKind && (
        <HStack gap={1} minWidth={0} color="fg.muted" {...(onImage ? PILL : {})}>
          <Box as="span" flexShrink={0} color="fg.subtle" display="flex">
            <Bot size={12} aria-hidden />
          </Box>
          <Text as="span" truncate>
            {AGENT_KIND_CHIP_LABELS[focusKind]}
          </Text>
        </HStack>
      )}
      <TrunkBadge trunk={trunk} />
    </HStack>
  );
}

/** The template's category as its coloured icon; its name is the hover and the spoken label. */
function TrunkBadge({ trunk }: { trunk: LibraryTemplate["trunk"] }) {
  const Icon = TRUNK_ICONS[trunk];
  return (
    <Box
      title={trunk}
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      width="24px"
      height="24px"
      borderRadius="md"
      colorPalette={TRUNK_PALETTES[trunk]}
      background="colorPalette.subtle"
      color="colorPalette.fg"
    >
      <Icon size={13} aria-hidden />
      <VisuallyHidden>{trunk}</VisuallyHidden>
    </Box>
  );
}

/**
 * "Add to this project", or "Added" linking to the board already made from the template
 * (AC145).
 */
export function AddTemplateButton({
  name,
  isCreating,
  addedHref,
  onCreate,
}: {
  name: string;
  isCreating: boolean;
  /** The address of the board this project already made from the template, if any. */
  addedHref: string | undefined;
  onCreate: () => void;
}) {
  const host = useAnalyticsHost();
  if (addedHref) {
    // A real link, so a modified click still opens the board in a new tab.
    return (
      <Button asChild size="sm" variant="outline" colorPalette="gray">
        <a
          href={addedHref}
          aria-label={`${name} is added: open its board`}
          onClick={(event) => {
            if (opensElsewhere(event)) return;
            event.preventDefault();
            host.navigate(addedHref);
          }}
        >
          <Check size={14} aria-hidden />
          Added
        </a>
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="solid"
      colorPalette="accent"
      aria-label={`Add ${name} to this project`}
      loading={isCreating}
      loadingText="Adding…"
      onClick={onCreate}
    >
      <Plus size={14} aria-hidden />
      Add to this project
    </Button>
  );
}
