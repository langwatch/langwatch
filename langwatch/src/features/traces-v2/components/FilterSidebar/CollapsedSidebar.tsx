import { HStack, IconButton, Separator, VStack } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import { PanelLeftOpen } from "lucide-react";
import type React from "react";
import {
  getFacetValues,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import { CollapsedFacetIcon } from "./CollapsedFacetIcon";
import type {
  CategoricalSection,
  RangeSectionData,
  TooltipLine,
} from "./types";
import { getFacetIcon, getRangeFormatter, summarizeRange } from "./utils";

interface CollapsedSidebarProps {
  ast: LiqeQuery;
  categoricals: CategoricalSection[];
  ranges: RangeSectionData[];
  onExpand: () => void;
}

export const CollapsedSidebar: React.FC<CollapsedSidebarProps> = ({
  ast,
  categoricals,
  ranges,
  onExpand,
}) => {
  const activeRanges = ranges
    .map((range) => {
      const value = getRangeValue(ast, range.key);
      return value ? { range, value } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // Group categoricals by their SectionGroup so the collapsed rail mirrors
  // the expanded sidebar's group separators. Same categorisation users see
  // when expanded — just rendered as icon clusters with thin separators.
  const groupedCategoricals = groupBySection(categoricals);

  return (
    <VStack height="full" gap={0} align="stretch" overflow="hidden" as="aside">
      <VStack
        flex={1}
        paddingY={2}
        gap={1}
        align="center"
        overflowY="auto"
        overflowX="hidden"
      >
        {groupedCategoricals.map((cluster, idx) => (
          <VStack key={cluster.key} gap={1} align="center" width="full">
            {idx > 0 && (
              <Separator
                marginX={2}
                marginY={0.5}
                width="auto"
                alignSelf="stretch"
              />
            )}
            {cluster.items.map((cat) => (
              <CategoricalCollapsedIcon
                key={cat.key}
                ast={ast}
                section={cat}
                onClick={onExpand}
              />
            ))}
          </VStack>
        ))}

        {activeRanges.length > 0 && (
          <Separator marginX={2} marginY={1} width="auto" alignSelf="stretch" />
        )}

        {activeRanges.map(({ range, value }) => (
          <RangeCollapsedIcon
            key={range.key}
            section={range}
            from={value.from}
            to={value.to}
            onClick={onExpand}
          />
        ))}
      </VStack>

      <Separator />
      <HStack justify="center" paddingY={1.5}>
        <IconButton
          aria-label="Expand sidebar"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={onExpand}
        >
          <PanelLeftOpen size={12} />
        </IconButton>
      </HStack>
    </VStack>
  );
};

/**
 * Group categoricals by their SectionGroup, preserving original order so
 * the user-customised group ordering from the expanded sidebar carries
 * through to the collapsed rail. Sections without a group fall into a
 * trailing "ungrouped" cluster.
 */
function groupBySection(
  sections: CategoricalSection[],
): Array<{ key: string; items: CategoricalSection[] }> {
  const order: string[] = [];
  const buckets = new Map<string, CategoricalSection[]>();
  for (const cat of sections) {
    const key = cat.group ?? "__ungrouped__";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(cat);
  }
  return order.map((key) => ({ key, items: buckets.get(key) ?? [] }));
}

const CategoricalCollapsedIcon: React.FC<{
  ast: LiqeQuery;
  section: CategoricalSection;
  onClick: () => void;
}> = ({ ast, section, onClick }) => {
  const facet = getFacetValues(ast, section.key);
  const activeCount = facet.include.length + facet.exclude.length;
  const tooltipLines: TooltipLine[] = [
    ...facet.include.map((value) => ({ text: `+ ${value}`, negated: false })),
    ...facet.exclude.map((value) => ({ text: `− ${value}`, negated: true })),
  ];

  return (
    <CollapsedFacetIcon
      icon={getFacetIcon({ key: section.key, group: section.group })}
      label={section.label}
      isActive={activeCount > 0}
      badgeCount={activeCount}
      tooltipLines={tooltipLines}
      previewValues={section.topValues}
      onClick={onClick}
    />
  );
};

const RangeCollapsedIcon: React.FC<{
  section: RangeSectionData;
  from: number | undefined;
  to: number | undefined;
  onClick: () => void;
}> = ({ section, from, to, onClick }) => {
  const summary = summarizeRange({
    from,
    to,
    format: getRangeFormatter(section.key),
  });

  return (
    <CollapsedFacetIcon
      icon={getFacetIcon({ key: section.key, group: section.group })}
      label={section.label}
      isActive
      tooltipLines={[{ text: summary, negated: false }]}
      onClick={onClick}
    />
  );
};
