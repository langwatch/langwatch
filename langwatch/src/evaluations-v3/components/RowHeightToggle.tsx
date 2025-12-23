import { Button, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { ListChevronsDownUp, ListChevronsUpDown, SlidersHorizontal } from "lucide-react";

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
    icon: <ListChevronsDownUp size={18} />,
  },
  {
    value: "expanded",
    label: "Expanded",
    icon: <ListChevronsUpDown size={18} />,
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
                <Button
                  key={option.value}
                  variant={isActive ? "surface" : "ghost"}
                  onClick={() => setRowHeightMode(option.value)}
                  display="flex"
                  flexDirection="column"
                  alignItems="center"
                  gap={1.5}
                  paddingX={4}
                  paddingY={3}
                  height="auto"
                  minWidth="80px"
                  fontSize="12px"
                >
                  {option.icon}
                  <Text>{option.label}</Text>
                </Button>
              );
            })}
          </HStack>
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
}
