/**
 * One template, top to bottom: its name, its job and a preview of the top of its board, then
 * a one-row footer (a focus template's agent type, the widget count), then whatever actions
 * the surface gives it. Cards carry no data status: missing data shows inside the widgets.
 */

import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Bot, Check, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import { AGENT_KIND_CHIP_LABELS } from "../../catalogue/index.ts";
import type { LibraryTemplate } from "../../model/template-library.ts";
import { TemplatePreview } from "./template-preview.tsx";

export function TemplateCard({
  template,
  actions,
}: {
  template: LibraryTemplate;
  /** What this surface lets the member do with the template, such as add it. */
  actions?: ReactNode;
}) {
  const { board, focusKind, widgetCount, preview } = template;
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
      <TemplatePreview preview={preview} />
      {/* One fixed-height row on every card, the agent type slot kept even when empty, so the
          actions below sit level across a row. */}
      <HStack height="20px" minWidth={0} justify="space-between" gap={3} fontSize="12px">
        <HStack gap={1} minWidth={0} color="fg.muted">
          {focusKind && (
            <>
              <Bot size={12} aria-hidden />
              <Text as="span" truncate>
                {AGENT_KIND_CHIP_LABELS[focusKind]}
              </Text>
            </>
          )}
        </HStack>
        <Text flexShrink={0} color="fg.muted">
          {widgetCount} widgets
        </Text>
      </HStack>
      {actions && <HStack gap={2}>{actions}</HStack>}
    </VStack>
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
