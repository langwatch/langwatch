import {
  Box,
  Button,
  Collapsible,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type React from "react";
import { useState } from "react";

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
   * Fired on shift-click of the header so the parent can collapse-all /
   * expand-all in one go. `nextOpen` is the state the clicked section
   * is moving toward.
   */
  onShiftToggle?: (nextOpen: boolean) => void;
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
  onShiftToggle,
  children,
}) => {
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
      <VStack align="stretch" paddingX={3} paddingY={2} gap={1} data-group>
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
                  <Icon boxSize="12px" color={hasActive ? "fg" : "fg.subtle"}>
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
                  _groupHover={{ color: "fg" }}
                >
                  {title}
                </Text>
                {!effectiveOpen &&
                  valueCount !== undefined &&
                  valueCount > 0 && (
                    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                      {valueCount}
                    </Text>
                  )}
                {activeIndicator}
              </HStack>
              <Icon color="fg.subtle" boxSize="12px" mr={2}>
                {effectiveOpen ? <ChevronUp /> : <ChevronDown />}
              </Icon>
            </Button>
          </Collapsible.Trigger>
        </HStack>

        <Collapsible.Content>
          <Box marginTop={1}>{children}</Box>
        </Collapsible.Content>
      </VStack>
    </Collapsible.Root>
  );
};
