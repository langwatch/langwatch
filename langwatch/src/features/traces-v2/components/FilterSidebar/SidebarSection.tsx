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
  /** Controlled open state. If provided alongside onOpenChange, defaultExpanded is ignored. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Initial open state when uncontrolled. */
  defaultExpanded?: boolean;
  /** Total count of values in the section, shown when collapsed. */
  valueCount?: number;
  /** Indicator rendered next to the title — e.g. selection badge. */
  activeIndicator?: React.ReactNode;
  /** When true, the title gets the active treatment to flag selected content. */
  hasActive?: boolean;
  /** Drag handle props from a sortable parent — when set, a grip is shown. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  open,
  onOpenChange,
  defaultExpanded = false,
  valueCount,
  activeIndicator,
  hasActive = false,
  dragHandleProps,
  children,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const isControlled = open !== undefined;
  const effectiveOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
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
              opacity={0}
              transition="opacity 100ms ease"
              _groupHover={{ opacity: 0.5 }}
              _hover={{ opacity: 1 }}
              _active={{ cursor: "grabbing" }}
              display="flex"
              alignItems="center"
              marginLeft="-14px"
              aria-label={`Drag ${title}`}
            >
              <Icon boxSize="12px">
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
            >
              <HStack gap={1.5}>
                <Text
                  textStyle="2xs"
                  fontWeight={hasActive ? "600" : "500"}
                  color={hasActive ? "fg" : "fg.subtle"}
                  textTransform="uppercase"
                  letterSpacing="0.08em"
                >
                  {title}
                </Text>
                {!effectiveOpen &&
                  valueCount !== undefined &&
                  valueCount > 0 && (
                    <Text
                      textStyle="2xs"
                      color="fg.subtle"
                      fontFamily="mono"
                    >
                      {valueCount}
                    </Text>
                  )}
                {activeIndicator}
              </HStack>
              <Icon color="fg.subtle" boxSize="12px">
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
