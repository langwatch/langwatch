/**
 * One template in the library: name and trunk badge, its job, a large preview, the agent kinds
 * it suits, and "Create board" with the widget count. A coming-soon one says how far it is
 * built. Given `onFilter`, the trunk badge and agent kind labels toggle the library's filters.
 */

import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Clock, Plus } from "lucide-react";

import {
  type CatalogueFilterPick,
  type CatalogueFilters,
  isPicked,
} from "../../model/catalogue-filter.ts";
import type { LibraryTemplate } from "../../model/template-library.ts";
import { AgentKindLabels, CatalogueFilterLabel, TRUNK_PALETTES } from "./catalogue-filters.tsx";
import { TemplatePreview } from "./template-preview.tsx";

export function TemplateCard({
  template,
  isCreating,
  onCreate,
  filters,
  onFilter,
}: {
  template: LibraryTemplate;
  isCreating: boolean;
  onCreate: () => void;
  /** The view the labels show as picked; only where the labels filter. */
  filters?: CatalogueFilters;
  onFilter?: (pick: CatalogueFilterPick) => void;
}) {
  const { board, trunk, agentKinds, widgetCount, preview } = template;
  const progress = board.comingSoon;
  const trunkPick: CatalogueFilterPick = { group: "trunks", value: trunk };
  return (
    <VStack
      as="article"
      aria-label={board.name}
      align="stretch"
      gap={4}
      padding={{ base: 5, md: 6 }}
      minWidth={0}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="xl"
      background="bg.panel"
    >
      <VStack align="stretch" gap={1} minWidth={0}>
        <HStack gap={2} minWidth={0}>
          <Text as="h3" fontSize="15px" fontWeight="semibold" color="fg" truncate>
            {board.name}
          </Text>
          <CatalogueFilterLabel
            shape="badge"
            label={trunk}
            colorPalette={TRUNK_PALETTES[trunk]}
            isActive={filters !== void 0 && isPicked({ filters, pick: trunkPick })}
            onToggle={onFilter && (() => onFilter(trunkPick))}
          />
        </HStack>
        {/* Two lines kept even for a short job, so previews line up across a row. */}
        <Text fontSize="13px" lineHeight="20px" minHeight="40px" color="fg.muted" lineClamp={2}>
          {board.summary ?? board.description}
        </Text>
      </VStack>
      <TemplatePreview preview={preview} isMuted={progress !== void 0} />
      <HStack gap={1} wrap="wrap">
        <AgentKindLabels agentKinds={agentKinds} filters={filters} onFilter={onFilter} />
      </HStack>
      <HStack gap={3} marginTop="auto">
        {progress ? (
          <Button
            size="sm"
            variant="subtle"
            colorPalette="gray"
            aria-label={`Create a board from ${board.name}`}
            disabled
          >
            <Clock size={14} aria-hidden />
            Coming soon
          </Button>
        ) : (
          <Button
            size="sm"
            variant="solid"
            colorPalette="accent"
            aria-label={`Create a board from ${board.name}`}
            loading={isCreating}
            loadingText="Creating…"
            onClick={onCreate}
          >
            <Plus size={14} aria-hidden />
            Create board
          </Button>
        )}
        <Text marginLeft="auto" fontSize="12px" color="fg.subtle" textAlign="end">
          {progress
            ? `${progress.built} of ${progress.total} widgets built`
            : `${widgetCount} widgets`}
        </Text>
      </HStack>
    </VStack>
  );
}
