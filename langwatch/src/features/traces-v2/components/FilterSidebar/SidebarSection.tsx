import {
  Box,
  Button,
  Collapsible,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronUp, GripVertical, Search } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { orGroupColor } from "./orGroupPalette";

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
   * Optional handler that removes this section from the sidebar (writes
   * to the per-user `facetVisibilityStore`). When provided, the header
   * grows a small × button that's revealed on hover so the affordance
   * doesn't claim chrome on every row. When omitted, no hide button is
   * rendered — used for sections without a registered key (or where
   * the parent doesn't want to expose hiding).
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
   * Set when this section's facet participates in a cross-facet OR
   * group. Renders an "OR · linked" pill in the header and a coloured
   * left-border on the section background so users can tell at a
   * glance that this row's value is OR-bound to other sections rather
   * than independently AND-toggleable.
   */
  orGroupId?: string;
  /**
   * Other field names in the same OR group. Surfaced in the OR pill
   * as "OR · model · service" so users know exactly which sections
   * are linked without scanning the rail for matching colours.
   */
  orPeers?: readonly string[];
  /**
   * When provided, a small magnifying-glass toggle renders just before
   * the chevron in the section header. `open` reflects whether the
   * typed-value filter is currently revealed. Clicks call `onToggle`.
   * If the section is collapsed when the user presses search, we
   * expand it first so the input is actually visible — "find a value"
   * implicitly means "look at the values."
   */
  searchToggleProps?: {
    open: boolean;
    onToggle: () => void;
  };
  /**
   * Content rendered between the header and the collapsible — always
   * visible, even when the section is collapsed. Used by FacetSection
   * to keep active values (and OR-group members) visible at all
   * times so the connector line and at-a-glance read of "what's
   * filtered" never depend on the section being expanded.
   */
  pinnedContent?: React.ReactNode;
  children: React.ReactNode;
}

const DRAG_HANDLE_HIT_AREA = "16px";
const DRAG_HANDLE_GLYPH = "12px";

export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  icon: SectionIcon,
  open,
  onOpenChange,
  valueCount,
  activeIndicator,
  hasActive = false,
  dragHandleProps,
  onHide,
  hideLabel = "Hide section",
  onShiftToggle,
  orGroupId,
  orPeers,
  searchToggleProps,
  pinnedContent,
  children,
}) => {
  const orPalette = orGroupId ? orGroupColor(orGroupId) : undefined;
  const peerLabel =
    orPeers && orPeers.length > 0
      ? orPeers.slice(0, 3).join(" · ") +
        (orPeers.length > 3 ? ` +${orPeers.length - 3}` : "")
      : null;
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const effectiveOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const handleTriggerClick: React.MouseEventHandler<HTMLButtonElement> = (
    e,
  ) => {
    if (!e.shiftKey || !onShiftToggle) return;
    e.preventDefault();
    e.stopPropagation();
    onShiftToggle(!effectiveOpen);
  };

  const handleTriggerKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (
    e,
  ) => {
    if (!e.shiftKey || !onShiftToggle) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    onShiftToggle(!effectiveOpen);
  };

  return (
    <Collapsible.Root
      open={effectiveOpen}
      onOpenChange={(e) => handleOpenChange(e.open)}
    >
      <VStack
        align="stretch"
        paddingX={3}
        paddingY={2}
        gap={1}
        role="group"
        data-group
        // When this section participates in a cross-facet OR group,
        // anchor a 3px coloured rail on the left edge so the section
        // visually links to its peers in the same group. Painting it
        // as a pseudo-rail (insetInlineStart border) instead of a real
        // border keeps the section's hit-rect unchanged.
        position="relative"
        _before={
          orPalette
            ? {
                content: '""',
                position: "absolute",
                top: "6px",
                bottom: "6px",
                left: 0,
                width: "3px",
                borderRadius: "0 2px 2px 0",
                bg: `${orPalette}.solid`,
                opacity: 0.85,
              }
            : undefined
        }
      >
        <HStack gap={1} width="full" align="center">
          {dragHandleProps && (
            <Box
              {...dragHandleProps}
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
              aria-label={`Reorder ${title} — press Space to pick up, then arrow keys`}
              title="Drag, or press Space to pick up with the keyboard"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon boxSize={DRAG_HANDLE_GLYPH}>
                <GripVertical />
              </Icon>
            </Box>
          )}
          <Collapsible.Trigger asChild>
            <Button
              variant="plain"
              size="sm"
              flex={1}
              justifyContent="space-between"
              paddingX={0}
              height="auto"
              minHeight="unset"
              fontWeight="normal"
              title="Shift-click (or Shift+Enter) to expand or collapse all sections"
              onClick={handleTriggerClick}
              onKeyDown={handleTriggerKeyDown}
            >
              <HStack gap={1.5} paddingRight="5px">
                {SectionIcon && (
                  <Icon
                    boxSize="12px"
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
                  letterSpacing="0.08em"
                  transition="color 100ms ease"
                  _hover={{ color: "fg" }}
                >
                  {title}
                </Text>
                {!effectiveOpen &&
                  valueCount !== undefined &&
                  valueCount > 0 && (
                    <Text
                      textStyle="2xs"
                      color="fg.subtle"
                      _hover={{ color: "fg" }}
                    >
                      {valueCount}
                    </Text>
                  )}
                {orPalette && (
                  <Box
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    gap="3px"
                    bg={`${orPalette}.subtle`}
                    color={`${orPalette}.fg`}
                    borderWidth="1px"
                    borderColor={`${orPalette}.muted`}
                    paddingX="6px"
                    paddingY="0"
                    borderRadius="4px"
                    fontSize="2xs"
                    fontWeight="700"
                    letterSpacing="0.04em"
                    title={
                      peerLabel
                        ? `OR-linked with: ${peerLabel}`
                        : "This facet is OR-linked"
                    }
                  >
                    OR
                    {peerLabel && (
                      <Box
                        as="span"
                        fontWeight="500"
                        textTransform="lowercase"
                        opacity={0.85}
                      >
                        · {peerLabel}
                      </Box>
                    )}
                  </Box>
                )}
                {activeIndicator}
              </HStack>
            </Button>
          </Collapsible.Trigger>
          {/* The chevron and filter toggle render as siblings of the
              Collapsible.Trigger (not inside it) so the filter button
              can sit between them without its clicks bubbling through
              to collapse the section. The chevron is a small button
              that mirrors the trigger's open state and forwards to
              the same handler. */}
          {searchToggleProps && (
            <Box
              as="button"
              type="button"
              aria-label={
                searchToggleProps.open
                  ? `Hide ${title} search`
                  : `Search ${title} values`
              }
              aria-pressed={searchToggleProps.open}
              width="16px"
              height="16px"
              display="flex"
              alignItems="center"
              justifyContent="center"
              borderRadius="sm"
              color={searchToggleProps.open ? "fg" : "fg.subtle"}
              bg={searchToggleProps.open ? "bg.muted" : undefined}
              flexShrink={0}
              _hover={{ color: "fg", bg: "bg.muted" }}
              transition="background 100ms ease, color 100ms ease"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                // Pressing search on a collapsed section also expands
                // it — otherwise the input toggles open behind a closed
                // Collapsible and the user types into invisible chrome.
                // We only auto-expand on the "opening" press; once
                // search is up, a second press hides the input but
                // leaves the section state alone (closing the section
                // is the chevron's job).
                if (!searchToggleProps.open && !effectiveOpen) {
                  handleOpenChange(true);
                }
                searchToggleProps.onToggle();
              }}
            >
              <Icon boxSize="11px">
                <Search />
              </Icon>
            </Box>
          )}
          <Box
            as="button"
            type="button"
            aria-label={effectiveOpen ? `Collapse ${title}` : `Expand ${title}`}
            width="16px"
            height="16px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="fg.subtle"
            flexShrink={0}
            marginRight={2}
            _hover={{ color: "fg" }}
            transition="color 100ms ease"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleOpenChange(!effectiveOpen);
            }}
          >
            <Icon boxSize="12px">
              {effectiveOpen ? <ChevronUp /> : <ChevronDown />}
            </Icon>
          </Box>
          {/* Per-section hover-X retired in Round 3 — removing a section
              is now done exclusively from the FacetManagerPopover.
              The inline X cluttered every section header for an action
              users rarely took and made the row feel "destructable"
              when most clicks were just trying to collapse / expand
              the section. `onHide` is still threaded through so the
              popover can drive the same store action. */}
        </HStack>

        {pinnedContent && (
          <Box marginTop={1}>{pinnedContent}</Box>
        )}

        <Collapsible.Content>
          <Box marginTop={pinnedContent ? 0 : 1}>{children}</Box>
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
  );
};
