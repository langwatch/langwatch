/**
 * One template, as the blank board and the templates library show it: name and trunk, job,
 * preview, agent kinds and "Create board"; a coming-soon one says how far it is built.
 * Given `onFilter`, the trunk and agent kind labels toggle the library's chips.
 */

import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

import { AGENT_KIND_LABELS } from "../../catalogue/index.ts";
import {
  type CatalogueFilterPick,
  type CatalogueFilters,
  isPicked,
} from "../../model/catalogue-filter.ts";
import type { LibraryTemplate } from "../../model/template-library.ts";
import { CatalogueFilterLabel, TRUNK_PALETTES } from "./catalogue-filter-chips.tsx";
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
  const label = (pick: CatalogueFilterPick) => ({
    isActive: filters !== void 0 && isPicked({ filters, pick }),
    onToggle: onFilter && (() => onFilter(pick)),
  });
  return (
    <VStack
      as="article"
      aria-label={board.name}
      align="stretch"
      gap={3}
      padding={4}
      minWidth={0}
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
    >
      <VStack align="stretch" gap={0.5} minWidth={0}>
        <HStack gap={2} minWidth={0}>
          <Text as="h3" fontSize="14px" fontWeight="semibold" color="fg" truncate>
            {board.name}
          </Text>
          <CatalogueFilterLabel
            label={trunk}
            colorPalette={TRUNK_PALETTES[trunk]}
            {...label({ group: "trunks", value: trunk })}
          />
        </HStack>
        <Text fontSize="12px" lineHeight="1.5" color="fg.muted" lineClamp={2}>
          {board.summary ?? board.description}
        </Text>
      </VStack>
      <TemplatePreview preview={preview} />
      <HStack gap={1} wrap="wrap">
        {agentKinds.length === 0 ? (
          <CatalogueFilterLabel label="Any agent" />
        ) : (
          agentKinds.map((kind) => (
            <CatalogueFilterLabel
              key={kind}
              label={AGENT_KIND_LABELS[kind]}
              {...label({ group: "agentKinds", value: kind })}
            />
          ))
        )}
      </HStack>
      <HStack gap={2} marginTop="auto" paddingTop={1}>
        <Button
          size="sm"
          variant="solid"
          aria-label={`Create a board from ${board.name}`}
          loading={isCreating}
          loadingText="Creating…"
          disabled={progress !== void 0}
          onClick={onCreate}
        >
          <Plus size={14} aria-hidden />
          Create board
        </Button>
        <Text marginLeft="auto" fontSize="11px" color="fg.subtle" textAlign="end">
          {progress
            ? `Coming soon: ${progress.built} of ${progress.total} widgets built`
            : `${widgetCount} widgets`}
        </Text>
      </HStack>
    </VStack>
  );
}
