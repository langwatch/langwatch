import { Badge, Button, Input, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { useFacetLensStore } from "../../stores/facetLensStore";
import {
  AUTO_EXPAND_THRESHOLD,
  MAX_EXPANDED_FACETS,
  MAX_VISIBLE_FACETS,
} from "./constants";
import { FacetRow } from "./FacetRow";
import { NoneFacetRow } from "./NoneFacetRow";
import { SidebarSection } from "./SidebarSection";
import type { FacetItem, FacetValueState } from "./types";

interface FacetSectionProps {
  title: string;
  icon?: React.ElementType;
  field: string;
  items: FacetItem[];
  getValueState: (value: string) => FacetValueState;
  onToggle: (field: string, value: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When set, renders a "(none)" row pinned at the bottom that toggles a `none:`/`has:` filter. */
  noneRow?: { active: boolean; onToggle: () => void };
  onShiftToggle?: (nextOpen: boolean) => void;
}

export const FacetSection: React.FC<FacetSectionProps> = ({
  title,
  icon,
  field,
  items,
  getValueState,
  onToggle,
  dragHandleProps,
  noneRow,
  onShiftToggle,
}) => {
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [showMore, setShowMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleToggle = useCallback(
    (value: string) => onToggle(field, value),
    [onToggle, field],
  );

  const activeCount = useMemo(
    () =>
      items.filter((i) => getValueState(i.value) !== "neutral").length +
      (noneRow?.active ? 1 : 0),
    [items, getValueState, noneRow?.active],
  );

  const filtered = useMemo(
    () => filterAndSortItems({ items, searchQuery }),
    [items, searchQuery],
  );

  const isHighCardinality = items.length >= MAX_VISIBLE_FACETS;
  const facetWindow = useMemo(
    () =>
      computeWindow({
        filtered,
        isHighCardinality,
        showMore,
        searchActive: searchQuery.length > 0,
      }),
    [filtered, isHighCardinality, showMore, searchQuery],
  );

  const maxCount = useMemo(
    () => facetWindow.visible.reduce((m, i) => (i.count > m ? i.count : m), 0),
    [facetWindow.visible],
  );

  const smartDefaultOpen =
    items.length <= AUTO_EXPAND_THRESHOLD || activeCount > 0;
  const effectiveOpen = lensOverride ?? smartDefaultOpen;

  return (
    <SidebarSection
      title={title}
      icon={icon}
      open={effectiveOpen}
      onOpenChange={(next) => setSectionOpen(field, next)}
      dragHandleProps={dragHandleProps}
      onShiftToggle={onShiftToggle}
      valueCount={items.length}
      hasActive={activeCount > 0}
      activeIndicator={
        activeCount > 0 ? (
          <Badge variant="solid" size="xs" colorPalette="blue" borderRadius="full">
            {activeCount}
          </Badge>
        ) : undefined
      }
    >
      <VStack gap={0.5} align="stretch">
        {facetWindow.visible.map((item) => (
          <FacetRow
            key={item.value}
            item={item}
            state={getValueState(item.value)}
            maxCount={maxCount}
            onToggle={handleToggle}
          />
        ))}

        {noneRow && !searchQuery && (
          <NoneFacetRow active={noneRow.active} onToggle={noneRow.onToggle} />
        )}

        {isHighCardinality && !searchQuery && (
          <ExpandToggle
            showMore={showMore}
            collapsedRemaining={facetWindow.collapsedRemaining}
            beyondExpanded={facetWindow.beyondExpanded}
            onShowMore={() => setShowMore(true)}
            onShowLess={() => setShowMore(false)}
          />
        )}

        {isHighCardinality && (
          <Input
            size="xs"
            placeholder="Filter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            marginTop={1}
            textStyle="xs"
          />
        )}
      </VStack>
    </SidebarSection>
  );
};

function filterAndSortItems({
  items,
  searchQuery,
}: {
  items: FacetItem[];
  searchQuery: string;
}): FacetItem[] {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  if (!searchQuery) return sorted;
  const q = searchQuery.toLowerCase();
  return sorted.filter((i) => i.label.toLowerCase().includes(q));
}

interface FacetWindow {
  visible: FacetItem[];
  collapsedRemaining: number;
  beyondExpanded: number;
}

function computeWindow({
  filtered,
  isHighCardinality,
  showMore,
  searchActive,
}: {
  filtered: FacetItem[];
  isHighCardinality: boolean;
  showMore: boolean;
  searchActive: boolean;
}): FacetWindow {
  if (searchActive || !isHighCardinality) {
    return { visible: filtered, collapsedRemaining: 0, beyondExpanded: 0 };
  }

  const limit = showMore ? MAX_EXPANDED_FACETS : MAX_VISIBLE_FACETS;
  const collapsedRemaining = Math.min(
    filtered.length - MAX_VISIBLE_FACETS,
    MAX_EXPANDED_FACETS - MAX_VISIBLE_FACETS,
  );
  const beyondExpanded = Math.max(filtered.length - MAX_EXPANDED_FACETS, 0);

  return {
    visible: filtered.slice(0, limit),
    collapsedRemaining: Math.max(collapsedRemaining, 0),
    beyondExpanded,
  };
}

interface ExpandToggleProps {
  showMore: boolean;
  collapsedRemaining: number;
  beyondExpanded: number;
  onShowMore: () => void;
  onShowLess: () => void;
}

const ExpandToggle: React.FC<ExpandToggleProps> = ({
  showMore,
  collapsedRemaining,
  beyondExpanded,
  onShowMore,
  onShowLess,
}) => {
  if (!showMore) {
    if (collapsedRemaining <= 0) return null;
    return (
      <LinkButton onClick={onShowMore}>
        Show {collapsedRemaining} more
      </LinkButton>
    );
  }
  return (
    <>
      {beyondExpanded > 0 && (
        <Text textStyle="xs" color="fg.subtle" paddingX={1} paddingY={0.5}>
          And {beyondExpanded} more — use search to filter
        </Text>
      )}
      <LinkButton onClick={onShowLess}>Show less</LinkButton>
    </>
  );
};

const LinkButton: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
}> = ({ children, onClick }) => (
  <Button
    variant="plain"
    size="xs"
    justifyContent="flex-start"
    width="fit-content"
    color="blue.fg"
    paddingX={1}
    paddingY={1}
    height="auto"
    _hover={{ textDecoration: "underline" }}
    onClick={onClick}
  >
    {children}
  </Button>
);
