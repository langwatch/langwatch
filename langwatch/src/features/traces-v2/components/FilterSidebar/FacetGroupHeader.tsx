import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import type React from "react";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";

interface FacetGroupHeaderProps {
  /** Sortable id — convention is `__group:<groupId>`. */
  id: string;
  label: string;
  /** True when the group has filters active that differ from the saved lens.
   * Renders a small dot next to the label so users can see at a glance which
   * groups are currently driving narrowing. */
  isModified?: boolean;
  /**
   * Facet entries (key + display label) that the backend has data for
   * but that are currently hidden from this group (density default OR
   * explicit hide). Drives the trailing "+ Add facet" menu — when
   * empty, the menu is not rendered.
   */
  hiddenKeys?: Array<{ key: string; label: string }>;
  /** Called with a hidden key to add it back to the sidebar. */
  onAddFacet?: (key: string) => void;
  children: React.ReactNode;
}

const DRAG_HANDLE_HIT_AREA = "16px";
const DRAG_HANDLE_GLYPH = "12px";

/**
 * Wraps a group of facet sections with a draggable label. The drag handle
 * grips the entire group — moving the header reorders the whole group in
 * the sidebar — while sections inside still reorder independently in their
 * own SortableContext.
 */
export const FacetGroupHeader: React.FC<FacetGroupHeaderProps> = ({
  id,
  label,
  isModified = false,
  hiddenKeys = [],
  onAddFacet,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const dragHandleProps = {
    ...attributes,
    ...(listeners ?? {}),
  } as React.HTMLAttributes<HTMLDivElement>;

  return (
    <Box
      ref={setNodeRef}
      role="group"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      position="relative"
      opacity={isDragging ? 0.6 : 1}
      zIndex={isDragging ? 1 : undefined}
      data-group-row
      // Subtle separator between groups so the categorisation
      // (identity / metrics / tags / …) is scannable without
      // having to read every section heading. The first group
      // gets neither the divider nor the wider top padding — its
      // header should sit close to the search bar above so the
      // first facet row stays in the user's eye line.
      css={{
        "&:not(:first-of-type)": {
          borderTopWidth: "1px",
          borderTopColor: "var(--chakra-colors-border-subtle)",
          marginTop: "var(--chakra-spacing-1)",
        },
        "&:not(:first-of-type) > [data-facet-group-heading]": {
          paddingTop: "var(--chakra-spacing-3)",
        },
      }}
    >
      <HStack
        data-facet-group-heading
        gap={1}
        paddingX={3}
        paddingTop={1}
        paddingBottom={1}
        align="center"
      >
        <Box
          {...dragHandleProps}
          cursor="grab"
          color="fg.subtle"
          opacity={0.4}
          transition="opacity 100ms ease, color 100ms ease"
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
          aria-label={`Reorder ${label} group — press Space to pick up, then arrow keys`}
          title="Drag, or press Space to pick up with the keyboard"
        >
          <Icon boxSize={DRAG_HANDLE_GLYPH}>
            <GripVertical />
          </Icon>
        </Box>
        <Text
          textStyle="2xs"
          fontWeight="700"
          color="fg.subtle"
          textTransform="uppercase"
          letterSpacing="0.1em"
          transition="color 120ms ease"
          _groupHover={{ color: "fg" }}
        >
          {label}
        </Text>
        {isModified && (
          <Box
            as="span"
            width="8px"
            height="8px"
            borderRadius="full"
            backgroundColor="blue.solid"
            display="inline-block"
            flexShrink={0}
            marginLeft={1}
            aria-label={`${label} group has filters applied`}
            title={`${label} group has filters applied`}
          />
        )}
        {/* Trailing "+ Add facet" menu — only renders when there are
            facets the backend has data for but the current view is
            hiding (density default or explicit hide). Lets the user
            re-introduce a section without flipping the global density
            switch or going into settings. The menu is a thin
            single-column list of facet labels; selecting one calls
            `onAddFacet(key)` which writes to the per-user visibility
            store. */}
        {hiddenKeys.length > 0 && onAddFacet && (
          <Box marginLeft="auto" flexShrink={0}>
            <MenuRoot>
              <Tooltip
                content={`Add a hidden ${label.toLowerCase()} facet`}
                positioning={{ placement: "top" }}
                openDelay={400}
              >
                <MenuTrigger asChild>
                  <Box
                    as="button"
                    // Bumped 18 → 22px and dropped the opacity dim so the
                    // hidden-facet picker is actually discoverable. The
                    // dimmed 18px button was the audit's "I can't find
                    // how to add the facet back" surface — common case
                    // for users on Comfortable density who need a
                    // specific tag the curated set doesn't include.
                    width="22px"
                    height="22px"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    borderRadius="sm"
                    color="fg.muted"
                    _hover={{ color: "fg", bg: "bg.muted" }}
                    aria-label={`Add a hidden ${label.toLowerCase()} facet`}
                    transition="color 100ms ease, background 100ms ease"
                  >
                    <Icon boxSize={3.5}>
                      <Plus />
                    </Icon>
                  </Box>
                </MenuTrigger>
              </Tooltip>
              <MenuContent
                minWidth="180px"
                maxHeight="320px"
                overflowY="auto"
              >
                {hiddenKeys.map(({ key, label: itemLabel }) => (
                  <MenuItem
                    key={key}
                    value={key}
                    onClick={() => onAddFacet(key)}
                  >
                    <Text textStyle="xs">{itemLabel}</Text>
                  </MenuItem>
                ))}
              </MenuContent>
            </MenuRoot>
          </Box>
        )}
      </HStack>
      {children}
    </Box>
  );
};
