import { Badge, Box, Button, Input, Text, VStack } from "@chakra-ui/react";
import { Kbd } from "~/components/ops/shared/Kbd";
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
  onToggle: (
    field: string,
    value: string,
    options?: { modifierKey?: boolean },
  ) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When set, renders a "(none)" row pinned at the bottom that toggles a `none:`/`has:` filter. */
  noneRow?: { active: boolean; onToggle: () => void };
  onShiftToggle?: (nextOpen: boolean) => void;
  /** Remove this section from the sidebar (per-user). */
  onHide?: () => void;
  orGroupId?: string;
  orPeers?: readonly string[];
  orMemberValues?: ReadonlySet<string>;
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
  onHide,
  orGroupId,
  orPeers,
  orMemberValues,
}) => {
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [showMore, setShowMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleToggle = useCallback(
    (value: string, options?: { modifierKey?: boolean }) =>
      onToggle(field, value, options),
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

  // Active rows = currently-filtered values + OR-group members. We
  // pin them above the collapsible content so they stay visible even
  // when the section is collapsed — the connector line keeps its
  // anchors and the user can see / remove what's filtered without
  // expanding the whole list.
  const activeItems = useMemo(
    () =>
      filtered.filter(
        (item) =>
          getValueState(item.value) !== "neutral" ||
          orMemberValues?.has(item.value),
      ),
    [filtered, getValueState, orMemberValues],
  );
  const activeValueSet = useMemo(
    () => new Set(activeItems.map((i) => i.value)),
    [activeItems],
  );
  const restItems = useMemo(
    () => filtered.filter((item) => !activeValueSet.has(item.value)),
    [filtered, activeValueSet],
  );

  const isHighCardinality = restItems.length >= MAX_VISIBLE_FACETS;
  const facetWindow = useMemo(
    () =>
      computeWindow({
        filtered: restItems,
        isHighCardinality,
        showMore,
        searchActive: searchQuery.length > 0,
      }),
    [restItems, isHighCardinality, showMore, searchQuery],
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
      onHide={onHide}
      hideLabel={`Hide ${title}`}
      orGroupId={orGroupId}
      orPeers={orPeers}
      valueCount={items.length}
      hasActive={activeCount > 0}
      pinnedContent={
        activeItems.length > 0 ? (
          <VStack gap={0.5} align="stretch">
            {activeItems.map((item) => (
              <FacetRow
                key={item.value}
                item={item}
                state={getValueState(item.value)}
                maxCount={maxCount}
                onToggle={handleToggle}
                orGroupId={
                  orMemberValues?.has(item.value) ? orGroupId : undefined
                }
                field={field}
              />
            ))}
          </VStack>
        ) : undefined
      }
      activeIndicator={
        activeCount > 0 ? (
          <Badge
            variant="solid"
            size="xs"
            colorPalette="blue"
            borderRadius="full"
            minW="4"
            height="4"
            paddingX={1}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
          >
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
            orGroupId={
              orMemberValues?.has(item.value) ? orGroupId : undefined
            }
            field={field}
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

        {/* Search is unconditional. The threshold-gated version (only
            shown when ≥10 items) hid Enter-to-apply behind cardinality
            — but the typed-value filter is exactly what users reach
            for on SHORT enumerated sections too (e.g. typing a custom
            error string into a `errorMessage` section that returned
            no top values, typing a one-off topic). Always on; the
            placeholder doubles as a hint that the typed value
            applies on Enter. */}
        {items.length > 0 && (
          // Inset paddingX so the Input's 2px focus ring has room to
          // render — without it, the ring's left/right edges were
          // clipped by the sidebar scroll container's
          // `overflowX: "hidden"`. The 2px gutter on each side keeps
          // the focused state legible without pulling the input far
          // away from the rest of the section's content.
          <VStack gap={0.5} align="stretch" marginTop={1} paddingX={0.5}>
            <Input
              size="xs"
              placeholder="Search or press Enter to apply…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const value = searchQuery.trim();
                if (!value) return;
                // Apply the typed value as a filter even when no
                // discovered facet matches — needed for rare values
                // (a one-off `metadata.tenant`, a long error string
                // copy-pasted from a log) that don't surface in the
                // top-50 facet response. Toggle is symmetric: typing
                // the same value again removes the filter.
                e.preventDefault();
                handleToggle(value);
                setSearchQuery("");
              }}
              textStyle="xs"
            />
            {searchQuery.trim() && facetWindow.visible.length === 0 && (
              <Text textStyle="2xs" color="fg.muted" paddingX={1}>
                No match. Press <Kbd>Enter</Kbd> to filter by "
                <Box as="span" fontWeight="600" color="fg">
                  {searchQuery.trim()}
                </Box>
                " anyway.
              </Text>
            )}
          </VStack>
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
        // The 50 backend-returned values are now all visible —
        // anything beyond that didn't surface in the top response,
        // so the hint points at the always-on search input (which
        // doubles as Enter-to-filter for arbitrary values).
        <Text textStyle="xs" color="fg.subtle" paddingX={1} paddingY={0.5}>
          {beyondExpanded}+ rare values aren't shown — type a value
          and press Enter to filter.
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
