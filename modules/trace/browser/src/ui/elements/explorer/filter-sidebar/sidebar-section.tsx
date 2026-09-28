import { Box, Button, Collapsible, chakra, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  List,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type React from "react";
import { memo, useState } from "react";

interface SidebarSectionProps {
  title: string;
  icon?: React.ElementType;
  /** Controlled open state. Omit to let SidebarSection manage its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Total count of values, shown when collapsed. */
  valueCount?: number;
  /** Indicator next to the title — e.g. selection badge. */
  activeIndicator?: React.ReactNode;
  /** Highlights the title to flag selected content. */
  hasActive?: boolean;
  /** Drag handle props from a sortable parent — enables the grip. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /**
   * Optional handler that removes this section from the sidebar (writes to the per-user
   * `facetVisibilityStore`). When provided, the header grows a small × button that's
   * revealed on hover so the affordance doesn't claim chrome on every row.
   */
  onHide?: () => void;
  /** Tooltip text for the hide button (defaults to "Hide section"). */
  hideLabel?: string;
  /**
   * Fired on shift-click of the header so the parent can collapse-all /
   * expand-all in one go. `nextOpen` is the state the clicked section
   * is moving toward.
   */
  onShiftToggle?: (nextOpen: boolean) => void;
  /**
   * When provided, a small filter toggle renders just before the chevron in the section
   * header. `open` reflects whether the typed-value filter is currently revealed.
   * Clicks call `onToggle`.
   */
  searchToggleProps?: {
    open: boolean;
    onToggle: () => void;
  };
  /**
   * When provided, a small toggle renders in the header (beside search / chevron) that
   * flips a numeric facet between its slider ("range") and its tick-list ("discrete")
   * presentation.
   */
  modeToggleProps?: {
    mode: "range" | "discrete";
    onToggle: () => void;
  };
  /**
   * Content rendered between the header and the collapsible — always visible, even when
   * the section is collapsed.
   */
  pinnedContent?: React.ReactNode;
  children: React.ReactNode;
}

// The grip lives in the section's left padding gutter as an absolutely positioned
// overlay rather than as a leading in-flow element.
const DRAG_HANDLE_HIT_AREA = "8px";
const DRAG_HANDLE_GLYPH = "10px";
// Negative inline-start that seats the absolute grip in the left padding
// gutter: the header HStack starts at the section's content edge, so −8px
// places the grip's right edge flush against it (= the gutter width).
const DRAG_HANDLE_GUTTER_OFFSET = "-8px";

function stopped(action: () => void) {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    action();
  };
}

/** The reorder grip, seated in the section's left gutter so the title aligns with the rows. */
function SectionDragGrip({
  title,
  dragHandleProps,
}: {
  title: string;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <Box
      {...dragHandleProps}
      position="absolute"
      insetInlineStart={DRAG_HANDLE_GUTTER_OFFSET}
      top="50%"
      transform="translateY(-50%)"
      cursor="grab"
      color="fg.subtle"
      opacity={0.4}
      transition="opacity 100ms ease, color 100ms ease"
      _groupHover={{ opacity: 0.75 }}
      _hover={{ opacity: 1, color: "fg" }}
      _active={{ cursor: "grabbing" }}
      _focusVisible={{
        opacity: 1,
        color: "fg",
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "1px",
        borderRadius: "sm",
      }}
      display="flex"
      alignItems="center"
      justifyContent="center"
      width={DRAG_HANDLE_HIT_AREA}
      height={DRAG_HANDLE_HIT_AREA}
      flexShrink={0}
      aria-label={`Reorder ${title}: press Space to pick up, then arrow keys`}
      title="Drag, or press Space to pick up with the keyboard"
      onClick={(e) => e.stopPropagation()}
    >
      <Icon boxSize={DRAG_HANDLE_GLYPH}>
        <GripVertical />
      </Icon>
    </Box>
  );
}

function SectionTitle({
  title,
  icon: SectionIcon,
  hasActive,
}: {
  title: string;
  icon?: React.ElementType;
  hasActive: boolean;
}) {
  return (
    <HStack gap={1.5} minWidth={0} width="full" flex={1}>
      {SectionIcon && (
        <Icon
          boxSize="12px"
          flexShrink={0}
          color={hasActive ? "fg" : "fg.subtle"}
          _hover={{ fill: "fg" }}
        >
          <SectionIcon />
        </Icon>
      )}
      <Text
        textStyle="2xs"
        fontWeight={hasActive ? "600" : "500"}
        color={hasActive ? "fg" : "fg.subtle"}
        textTransform="uppercase"
        letterSpacing="0.02em"
        transition="color 100ms ease"
        // The Chakra Button recipe sets `text-align: center`, which the title
        // inherits.
        textAlign="start"
        _hover={{ color: "fg" }}
        // flex+minWidth=0: title claims width, truncate engages late.
        flex={1}
        minWidth={0}
        truncate
      >
        {title}
      </Text>
    </HStack>
  );
}

function SearchToggle({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <chakra.button
      type="button"
      aria-label={open ? `Hide ${title} value search` : `Search ${title} values`}
      aria-pressed={open}
      width="16px"
      height="16px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="sm"
      color={open ? "fg" : "fg.subtle"}
      bg={open ? "bg.muted" : undefined}
      cursor="pointer"
      _hover={{ color: "fg", bg: "bg.muted" }}
      transition="background 100ms ease, color 100ms ease"
      onClick={stopped(onToggle)}
    >
      <Icon boxSize="11px">
        <Search />
      </Icon>
    </chakra.button>
  );
}

/** A numeric facet's slider/tick-list switch; the glyph shows the mode it switches to. */
function ModeToggle({
  title,
  mode,
  onToggle,
}: {
  title: string;
  mode: "range" | "discrete";
  onToggle: () => void;
}) {
  const isDiscrete = mode === "discrete";
  return (
    <Box width="16px" height="16px" flexShrink={0}>
      <chakra.button
        type="button"
        aria-label={
          isDiscrete ? `Show ${title} as a range slider` : `Show ${title} as a value list`
        }
        aria-pressed={isDiscrete}
        width="16px"
        height="16px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderRadius="sm"
        color="fg.subtle"
        cursor="pointer"
        _hover={{ color: "fg", bg: "bg.muted" }}
        transition="background 100ms ease, color 100ms ease"
        onClick={stopped(onToggle)}
      >
        <Icon boxSize="11px">{isDiscrete ? <SlidersHorizontal /> : <List />}</Icon>
      </chakra.button>
    </Box>
  );
}

const SidebarSectionInner: React.FC<SidebarSectionProps> = ({
  title,
  icon: SectionIcon,
  open,
  onOpenChange,
  valueCount,
  activeIndicator,
  hasActive = false,
  dragHandleProps,
  onHide: _onHide,
  hideLabel: _hideLabel = "Hide section",
  onShiftToggle,
  searchToggleProps,
  modeToggleProps,
  pinnedContent,
  children,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const effectiveOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  // Shift-click or Shift+Enter/Space on the title opens or closes every section.
  const toggleAllOnShift = (e: React.MouseEvent | React.KeyboardEvent, isActivation: boolean) => {
    if (!e.shiftKey || !onShiftToggle || !isActivation) return;
    e.preventDefault();
    e.stopPropagation();
    onShiftToggle(!effectiveOpen);
  };

  return (
    <Collapsible.Root open={effectiveOpen} onOpenChange={(e) => handleOpenChange(e.open)}>
      <VStack align="stretch" paddingX={2} paddingY={2} gap={1} as="fieldset" data-group>
        {/* position:relative anchors the absolute grip below to the header
            row (so it stays vertically centred on the title, not the whole
            expanded section). The grip is pulled into the left gutter so the
            in-flow header content (icon + title) starts at the section's
            content edge, aligning with the value rows beneath (T20). */}
        <HStack gap={1} width="full" align="center" position="relative">
          {dragHandleProps && <SectionDragGrip title={title} dragHandleProps={dragHandleProps} />}
          <Collapsible.Trigger asChild>
            <Button
              variant="plain"
              size="sm"
              flex={1}
              minWidth={0}
              justifyContent="flex-start"
              paddingX={0}
              height="auto"
              minHeight="unset"
              fontWeight="normal"
              title="Shift-click (or Shift+Enter) to expand or collapse all sections"
              onClick={(e) => toggleAllOnShift(e, true)}
              onKeyDown={(e) => toggleAllOnShift(e, e.key === "Enter" || e.key === " ")}
            >
              <SectionTitle title={title} icon={SectionIcon} hasActive={hasActive} />
            </Button>
          </Collapsible.Trigger>
          {/* Selection indicator ("any of" hint) — rendered as a sibling of
              the value-count / search / chevron so all header accessories
              form one tidy right-aligned column. Previously it lived inside
              the trigger right after the title, where the title's flex-grow
              shoved it into the middle of the header (it read as a stray
              badge floating in dead space). */}
          {activeIndicator}
          {/* Value-count slot — shown ONLY while the section is COLLAPSED,
              where it's the only hint of how many values the facet holds. When
              the section is expanded the values are right there, so the count
              is redundant — and a present-value tally like "1" sitting next to
              a list of five rows read as confusing clutter (it's the count of
              values with matches, not the row count). Right-aligned so the
              digits and the chevron form a clean vertical column. */}
          {!effectiveOpen && valueCount !== undefined && valueCount > 0 && (
            <Box minWidth="20px" textAlign="right" flexShrink={0} color="fg.subtle">
              <Text textStyle="2xs">{valueCount}</Text>
            </Box>
          )}
          {/* Chevron and search toggle as siblings: fixed 16px slots, consistent position. */}
          <Box width="16px" height="16px" flexShrink={0}>
            {searchToggleProps && (
              <SearchToggle
                title={title}
                open={searchToggleProps.open}
                onToggle={() => {
                  // Searching a collapsed section opens it, or the input would sit hidden.
                  if (!searchToggleProps.open && !effectiveOpen) handleOpenChange(true);
                  searchToggleProps.onToggle();
                }}
              />
            )}
          </Box>
          {/* Numeric facets get a presentation toggle (slider ↔ tick-list)
              between search and the chevron. The glyph shows the OTHER mode —
              what you'd switch to. */}
          {modeToggleProps && (
            <ModeToggle
              title={title}
              mode={modeToggleProps.mode}
              onToggle={modeToggleProps.onToggle}
            />
          )}
          <chakra.button
            type="button"
            aria-label={effectiveOpen ? `Collapse ${title}` : `Expand ${title}`}
            width="16px"
            height="16px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="fg.subtle"
            flexShrink={0}
            cursor="pointer"
            _hover={{ color: "fg" }}
            transition="color 100ms ease"
            onClick={stopped(() => handleOpenChange(!effectiveOpen))}
          >
            <Icon boxSize="12px">{effectiveOpen ? <ChevronUp /> : <ChevronDown />}</Icon>
          </chakra.button>
          {/* Per-section hover-X retired in Round 3 — removing a section
              is now done exclusively from the FacetManagerPopover.
              The inline X cluttered every section header for an action
              users rarely took and made the row feel "destructable"
              when most clicks were just trying to collapse / expand
              the section. `onHide` is still threaded through so the
              popover can drive the same store action. */}
        </HStack>

        {pinnedContent && <Box marginTop={1}>{pinnedContent}</Box>}

        <Collapsible.Content>
          <Box marginTop={pinnedContent ? 0 : 1}>{children}</Box>
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
  );
};

export const SidebarSection = memo(SidebarSectionInner);
