import { HStack, IconButton, Separator, VStack } from "@chakra-ui/react";
import { PanelLeftOpen } from "lucide-react";
import type React from "react";
import {
  getFacetValues,
  getRangeValue,
  type LiqeQuery,
} from "~/server/app-layer/traces/query-language/queryParser";
import { CollapsedFacetIcon } from "./CollapsedFacetIcon";
import type {
  CategoricalSection,
  RangeSectionData,
  TooltipLine,
} from "./types";
import {
  getFacetIcon,
  getRangeFormatter,
  summarizeRange,
} from "./utils";

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
        {categoricals.map((cat) => (
          <CategoricalCollapsedIcon
            key={cat.key}
            ast={ast}
            section={cat}
            onClick={onExpand}
          />
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
