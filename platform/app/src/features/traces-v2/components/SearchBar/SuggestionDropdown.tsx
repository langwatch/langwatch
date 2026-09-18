import {
  Badge,
  Box,
  Button,
  chakra,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BookOpen } from "lucide-react";
import type React from "react";
import { memo, useMemo } from "react";
import {
  SEARCH_FIELDS,
  type SearchFieldMeta,
} from "~/server/app-layer/traces/query-language/metadata";
import { useUIStore } from "../../stores/uiStore";
import {
  FACET_GROUPS,
  type FacetGroupDef,
  GROUP_ICONS,
  getFacetGroupId,
} from "../FilterSidebar/constants";
import { getFacetIcon } from "../FilterSidebar/utils";
import type { SuggestionState } from "./getSuggestionState";
import type { SuggestionRow, SuggestionUIState } from "./suggestionUI";

interface SuggestionDropdownProps {
  ui: SuggestionUIState;
  onSelect: (label: string) => void;
  /**
   * Horizontal offset (in pixels) from the search bar's left edge to the
   * cursor's screen position. The dropdown anchors there instead of the
   * far-left of the input — important when typing the second/third clause
   * so the suggestions sit under the active token, not back at column 0.
   */
  anchorX?: number;
}

export const SuggestionDropdown: React.FC<SuggestionDropdownProps> = ({
  ui,
  onSelect,
  anchorX,
}) => {
  if (!ui.state.open || ui.items.length === 0) return null;
  const { state } = ui;

  return (
    <Box
      position="absolute"
      top="calc(100% + 6px)"
      left={anchorX !== undefined ? `${Math.max(0, anchorX)}px` : 0}
      borderRadius="lg"
      zIndex={2050}
      minWidth="320px"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      // Match the standard Chakra popover shadow (no blue accent ring,
      // no extra outer halo) — previously a custom double-ring made the
      // dropdown read as a distinct visual primitive instead of "a
      // popover anchored to the search bar". Lifts off the page with a
      // soft layered shadow exactly like the other popovers in the app.
      boxShadow="md"
      animation="suggestion-dropdown-fade 120ms ease-out"
      css={{
        "@keyframes suggestion-dropdown-fade": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      <Box
        borderRadius="lg"
        overflow="hidden"
        display="flex"
        flexDirection="column"
        bg="bg.panel"
        position="relative"
      >
        <VStack gap={0} align="stretch" maxHeight="320px" overflowY="auto">
          <GroupedItems ui={ui} state={state} onSelect={onSelect} />
        </VStack>
        <DropdownFooter />
      </Box>
    </Box>
  );
};

const DropdownFooter: React.FC = () => {
  const setSyntaxHelpOpen = useUIStore((s) => s.setSyntaxHelpOpen);
  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      borderTopWidth="1px"
      borderColor="border"
      bg="bg.subtle"
      justify="space-between"
    >
      {/* ⏎ and ⇥ both accept the highlighted suggestion (see handleKey) —
          advertise Tab too so the documented affordance is discoverable
          from the dropdown itself, not just the syntax docs. */}
      <Text textStyle="2xs" color="fg.subtle">
        ↑↓ navigate · ⏎ ⇥ select · esc close
      </Text>
      <Button
        size="2xs"
        variant="ghost"
        color="blue.fg"
        onMouseDown={(event) => {
          // mouseDown so the editor's onBlur doesn't race with the click —
          // openning the drawer needs to win even though the search loses focus.
          event.preventDefault();
          setSyntaxHelpOpen(true);
        }}
      >
        <BookOpen size={11} />
        <Text textStyle="2xs">Syntax docs</Text>
      </Button>
    </HStack>
  );
};

/**
 * Renders the items partitioned by `group`. Field-mode dropdowns show
 * section headers (Trace / Span / Event / Eval / Metrics / Scenario);
 * value-mode dropdowns have no group and render as a single ungrouped
 * list. Selection index threads through the partitioned layout —
 * keyboard navigation walks the *flat* list (`ui.items`) and we map
 * each row's flat index back to a per-section slot when rendering.
 */
const GroupedItems: React.FC<{
  ui: SuggestionUIState;
  state: Extract<SuggestionState, { open: true }>;
  onSelect: (label: string) => void;
}> = ({ ui, state, onSelect }) => {
  const grouped = useMemo(() => groupRows(ui.items), [ui.items]);

  if (state.mode === "value") {
    return (
      <>
        {ui.items.map((row, index) => (
          <SuggestionRowView
            key={row.value}
            row={row}
            mode={state.mode}
            count={ui.itemCounts?.[row.value]}
            isSelected={index === ui.selectedIndex}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {grouped.map((section) => {
        const GroupIcon =
          section.groupId !== "other"
            ? GROUP_ICONS[section.groupId]
            : undefined;
        return (
          <Box key={section.groupId}>
            <HStack
              gap={1.5}
              paddingX={3}
              paddingY={1.5}
              bg="bg.subtle"
              borderTopWidth={section.first ? "0px" : "1px"}
              borderColor="border.subtle"
            >
              {GroupIcon && (
                <Icon boxSize="11px" color="fg.subtle">
                  <GroupIcon />
                </Icon>
              )}
              <Text
                textStyle="2xs"
                fontWeight="700"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.1em"
              >
                {section.label}
              </Text>
            </HStack>
            {section.rows.map(({ row, flatIndex }) => (
              <SuggestionRowView
                key={row.value}
                row={row}
                mode={state.mode}
                count={ui.itemCounts?.[row.value]}
                isSelected={flatIndex === ui.selectedIndex}
                onSelect={onSelect}
              />
            ))}
          </Box>
        );
      })}
    </>
  );
};

interface GroupedSection {
  /** FACET_GROUPS id (drives the header icon), or `"other"` for fields with
   *  no sidebar facet group (time, scenario, dynamic-attribute prefixes). */
  groupId: FacetGroupDef["id"] | "other";
  label: string;
  first: boolean;
  rows: Array<{ row: SuggestionRow; flatIndex: number }>;
}

const FACET_GROUP_LABEL = new Map(
  FACET_GROUPS.map((g) => [g.id, g.label] as const),
);

/**
 * Bucket the flat suggestion list by the SAME taxonomy the facet sidebar /
 * manager use (`getFacetGroupId`), so the dropdown's section headers read
 * identically to the facet manager — "Traces", "Errors", "Spans & Events",
 * etc. Fields with no facet group (time, scenario, dynamic prefixes) fall
 * into a trailing "Other". Group order follows `FACET_GROUPS`; within a
 * group, rows keep their (rank-sorted) flat-list order.
 */
function groupRows(items: SuggestionRow[]): GroupedSection[] {
  const buckets = new Map<
    string,
    {
      groupId: FacetGroupDef["id"] | "other";
      label: string;
      rows: Array<{ row: SuggestionRow; flatIndex: number }>;
    }
  >();
  for (let i = 0; i < items.length; i++) {
    const row = items[i]!;
    const facetGroupId = getFacetGroupId(row.value);
    const bucketKey = facetGroupId ?? "other";
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        groupId: facetGroupId ?? "other",
        label: facetGroupId
          ? (FACET_GROUP_LABEL.get(facetGroupId) ?? "Other")
          : "Other",
        rows: [],
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.rows.push({ row, flatIndex: i });
  }
  // Order sections by FACET_GROUPS, then the trailing `Other`.
  const ordered: GroupedSection[] = [];
  for (const group of FACET_GROUPS) {
    const b = buckets.get(group.id);
    if (b) {
      ordered.push({
        groupId: b.groupId,
        label: b.label,
        first: ordered.length === 0,
        rows: b.rows,
      });
      buckets.delete(group.id);
    }
  }
  const other = buckets.get("other");
  if (other) {
    ordered.push({
      groupId: "other",
      label: "Other",
      first: ordered.length === 0,
      rows: other.rows,
    });
  }
  return ordered;
}

interface SuggestionRowProps {
  row: SuggestionRow;
  /** Only the bits of the suggestion state a row actually needs. Passing the
   *  whole state object (which carries the per-keystroke `query`) would make
   *  every row's props change on every keystroke and defeat the row memo;
   *  `mode` is stable while typing within one field. */
  mode: "field" | "value";
  count?: number;
  isSelected: boolean;
  onSelect: (label: string) => void;
}

// Memoised: a keystroke re-runs the suggestion list, but most rows are
// unchanged — only the previously/newly-selected rows flip `isSelected`.
// Without memo every row re-rendered (re-instantiating a Lucide icon each),
// which dominated the per-keystroke cost once the icon-rich redesign landed.
const SuggestionRowView: React.FC<SuggestionRowProps> = memo(
  function SuggestionRowView({ row, mode, count, isSelected, onSelect }) {
    const isFieldMode = mode === "field";
    const fieldMeta =
      isFieldMode && !row.isPrefix ? SEARCH_FIELDS[row.value] : undefined;
    // Field mode: the same per-facet icon the sidebar / manager use, so the
    // two surfaces read with one visual language.
    const FieldIcon = isFieldMode
      ? getFacetIcon({ key: row.value })
      : undefined;
    // In value-mode, when the row carries a human-readable label (e.g.
    // evaluator name "Faithfulness") that differs from the raw id
    // (`ragas/faithfulness`), surface the id as a muted hint after the
    // label so the operator knows what's actually going into the query.
    const idHint =
      mode === "value" && row.label !== row.value ? row.value : null;

    return (
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        width="full"
        paddingX={3}
        paddingY={1.5}
        gap={2}
        textAlign="left"
        bg={isSelected ? "blue.solid/12" : "transparent"}
        color="fg"
        cursor="pointer"
        _hover={{ bg: "blue.solid/8" }}
        onMouseDown={(event) => {
          event.preventDefault();
          onSelect(row.value);
        }}
      >
        <HStack gap={2} minWidth={0} flex={1}>
          {FieldIcon && (
            <Icon boxSize="13px" color="fg.subtle" flexShrink={0}>
              <FieldIcon />
            </Icon>
          )}
          {isFieldMode ? (
            // Human label leads (reads like the facet sidebar), with the raw
            // query field as a mono hint so users learn the syntax.
            <>
              <Text
                textStyle="xs"
                color="fg"
                fontWeight="medium"
                flexShrink={0}
                truncate
              >
                {row.label}
              </Text>
              <Text
                textStyle="2xs"
                color="fg.subtle"
                fontFamily="mono"
                truncate
                minWidth={0}
                flexShrink={1}
              >
                {row.field}
              </Text>
            </>
          ) : (
            // Value mode: `field:value` with the value emphasised.
            <Text textStyle="xs" flexShrink={0}>
              <Text as="span" color="fg.muted">
                {row.field}:
              </Text>
              <Text as="span" color="fg" fontWeight="medium">
                {row.label}
              </Text>
            </Text>
          )}
          {idHint && (
            <Text
              textStyle="2xs"
              color="fg.subtle"
              fontFamily="mono"
              truncate
              minWidth={0}
              flexShrink={1}
            >
              {idHint}
            </Text>
          )}
          {fieldMeta && <FieldTypeBadge meta={fieldMeta} />}
          {row.isPrefix && (
            <Badge
              size="xs"
              variant="subtle"
              colorPalette="purple"
              flexShrink={0}
            >
              drill in
            </Badge>
          )}
        </HStack>
        {count !== undefined && (
          <Text textStyle="2xs" color="fg.subtle" marginLeft={2}>
            {count}
          </Text>
        )}
      </chakra.button>
    );
  },
);

const TYPE_PALETTE: Record<SearchFieldMeta["valueType"], string> = {
  categorical: "blue",
  range: "green",
  text: "gray",
  existence: "purple",
};

/** Short, glanceable label for each value-type. The example operators that
 *  used to render alongside were noisy in a per-row context — the badge
 *  alone tells the user what kind of value the field takes. */
const TYPE_LABEL: Record<SearchFieldMeta["valueType"], string> = {
  categorical: "value",
  range: "number",
  text: "text",
  existence: "yes / no",
};

const FieldTypeBadge: React.FC<{ meta: SearchFieldMeta }> = ({ meta }) => (
  <Badge
    size="xs"
    variant="subtle"
    colorPalette={TYPE_PALETTE[meta.valueType]}
    flexShrink={0}
    marginLeft="auto"
  >
    {TYPE_LABEL[meta.valueType]}
  </Badge>
);
