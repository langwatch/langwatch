import { Box, Circle, Grid, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useRef } from "react";

type IconListItem<T> = {
  title: string;
  value: T;
  icon?: React.ComponentType;
};

interface IconRadioCardGroupProps<T extends string = string> {
  items: IconListItem<T>[];
  value?: T;
  onChange: (value: T | undefined) => void;
  direction?: "horizontal" | "vertical";
  size?: "sm" | "md" | "lg";
  variant?: "outline";
  maxColumns?: number;
}

export const IconRadioCardGroup = <T extends string = string>({
  items,
  value,
  onChange,
  direction: layout = "horizontal",
  maxColumns,
}: IconRadioCardGroupProps<T>) => {
  const isHorizontal = layout === "horizontal";
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % items.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + items.length) % items.length;
      }
      if (nextIndex !== null) {
        const nextItem = items[nextIndex];
        if (nextItem) {
          onChange(nextItem.value);
          const buttons =
            groupRef.current?.querySelectorAll<HTMLButtonElement>(
              '[role="radio"] button',
            );
          buttons?.[nextIndex]?.focus();
        }
      }
    },
    [items, onChange],
  );

  const renderItem = (item: IconListItem<T>, index: number) => {
    const isSelected = value === item.value;

    return (
      <Box
        key={item.value}
        asChild
        role="radio"
        aria-checked={isSelected}
        onClick={() => onChange(item.value)}
        cursor="pointer"
        borderWidth="1px"
        borderColor={isSelected ? "orange.400" : "rgba(0,0,0,0.06)"}
        borderRadius="12px"
        bg={isSelected ? "orange.subtle" : "rgba(255,255,255,0.6)"}
        backdropFilter="blur(12px)"
        p="3"
        transition="all 0.2s ease"
        boxShadow={isSelected ? "0 0 0 1px rgba(237,137,38,0.15)" : "none"}
        _hover={{
          borderColor: isSelected ? "orange.400" : "rgba(0,0,0,0.10)",
          bg: isSelected ? "orange.subtle" : "rgba(255,255,255,0.85)",
          boxShadow: isSelected
            ? "0 0 0 1px rgba(237,137,38,0.15)"
            : "0 2px 8px rgba(0,0,0,0.04)",
          transform: "translateY(-1px)",
        }}
        w="full"
        minW="0"
        textAlign="start"
      >
        <button
          type="button"
          tabIndex={isSelected ? 0 : -1}
          onKeyDown={(e) => handleKeyDown(e, index)}
        >
          <HStack align="center" justify="space-between" w="full" minW="0">
            <HStack align="center" gap="2" minW="0" flex="1">
              {item.icon && (
                <Icon
                  size="sm"
                  color={isSelected ? "orange.fg" : "fg.muted"}
                  transition="color 0.15s ease"
                  flexShrink={0}
                >
                  <item.icon />
                </Icon>
              )}

              <Text
                textStyle="sm"
                fontWeight="medium"
                color="fg.DEFAULT"
                truncate
              >
                {item.title}
              </Text>
            </HStack>

            <Circle
              size="4"
              borderWidth="1px"
              borderColor={isSelected ? "orange.solid" : "border.emphasized"}
              bg={isSelected ? "orange.solid" : "bg.surface"}
              transition="all 0.15s ease"
              flexShrink={0}
            >
              {isSelected && <Circle size="1.5" bg="white" />}
            </Circle>
          </HStack>
        </button>
      </Box>
    );
  };

  if (isHorizontal) {
    const cols = maxColumns ? Math.min(items.length, maxColumns) : items.length;
    return (
      <Grid
        ref={groupRef}
        role="radiogroup"
        templateColumns={{
          base: "1fr",
          md: `repeat(${cols}, minmax(0, 1fr))`,
        }}
        gap="2"
        w="full"
      >
        {items.map(renderItem)}
      </Grid>
    );
  }

  return (
    <Stack ref={groupRef} role="radiogroup" direction="column" gap="2" w="full">
      {items.map(renderItem)}
    </Stack>
  );
};

export default IconRadioCardGroup;
