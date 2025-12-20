import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { AlignJustify, Maximize2, SlidersHorizontal } from "lucide-react";

import { Popover } from "~/components/ui/popover";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { RowHeightMode } from "../types";

type ToggleOption = {
  value: RowHeightMode;
  label: string;
  icon: React.ReactNode;
};

const options: ToggleOption[] = [
  {
    value: "compact",
    label: "Compact",
    icon: <AlignJustify size={18} />,
  },
  {
    value: "expanded",
    label: "Expanded",
    icon: <Maximize2 size={18} />,
  },
];

/**
 * Popover with toggle options for row height mode.
 * Compact mode shows a limited height with fade effect.
 * Expanded mode shows all content (up to character limit).
 */
export function RowHeightToggle() {
  const { rowHeightMode, setRowHeightMode } = useEvaluationsV3Store((state) => ({
    rowHeightMode: state.ui.rowHeightMode,
    setRowHeightMode: state.setRowHeightMode,
  }));

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton
          variant="ghost"
          size="sm"
          color="gray.500"
          _hover={{ color: "gray.700", bg: "gray.100" }}
        >
          <SlidersHorizontal size={18} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="auto" padding={3}>
        <VStack align="stretch" gap={2}>
          <Text fontSize="xs" fontWeight="medium" color="gray.500">
            Row height
          </Text>
          <HStack gap={2}>
            {options.map((option) => {
              const isActive = rowHeightMode === option.value;
              return (
                <Box
                  key={option.value}
                  as="button"
                  onClick={() => setRowHeightMode(option.value)}
                  paddingX={4}
                  paddingY={3}
                  display="flex"
                  flexDirection="column"
                  alignItems="center"
                  gap={1.5}
                  fontSize="12px"
                  fontWeight={isActive ? "medium" : "normal"}
                  color={isActive ? "gray.800" : "gray.500"}
                  bg={isActive ? "white" : "gray.50"}
                  border="1px solid"
                  borderColor={isActive ? "gray.300" : "gray.200"}
                  borderRadius="md"
                  cursor="pointer"
                  transition="all 0.15s"
                  minWidth="80px"
                  _hover={{
                    borderColor: "gray.300",
                    bg: isActive ? "white" : "gray.100",
                  }}
                >
                  {option.icon}
                  <Text>{option.label}</Text>
                </Box>
              );
            })}
          </HStack>
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
}
