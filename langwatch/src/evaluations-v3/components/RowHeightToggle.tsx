import { Box, HStack, Text } from "@chakra-ui/react";
import { AlignJustify, Maximize2 } from "lucide-react";

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
    icon: <AlignJustify size={14} />,
  },
  {
    value: "expanded",
    label: "Expanded",
    icon: <Maximize2 size={14} />,
  },
];

/**
 * Toggle button to switch between compact and expanded row height modes.
 * Compact mode shows a limited height with fade effect.
 * Expanded mode shows all content (up to character limit).
 */
export function RowHeightToggle() {
  const { rowHeightMode, setRowHeightMode } = useEvaluationsV3Store((state) => ({
    rowHeightMode: state.ui.rowHeightMode,
    setRowHeightMode: state.setRowHeightMode,
  }));

  return (
    <HStack
      gap={0}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
      overflow="hidden"
      bg="gray.50"
    >
      {options.map((option) => {
        const isActive = rowHeightMode === option.value;
        return (
          <Box
            key={option.value}
            as="button"
            onClick={() => setRowHeightMode(option.value)}
            paddingX={3}
            paddingY={1.5}
            display="flex"
            alignItems="center"
            gap={1.5}
            fontSize="13px"
            fontWeight={isActive ? "medium" : "normal"}
            color={isActive ? "gray.800" : "gray.500"}
            bg={isActive ? "white" : "transparent"}
            borderRight={option.value === "compact" ? "1px solid" : undefined}
            borderColor="gray.200"
            boxShadow={isActive ? "sm" : undefined}
            cursor="pointer"
            transition="all 0.15s"
            _hover={{
              color: isActive ? "gray.800" : "gray.700",
              bg: isActive ? "white" : "gray.100",
            }}
          >
            {option.icon}
            <Text>{option.label}</Text>
          </Box>
        );
      })}
    </HStack>
  );
}
