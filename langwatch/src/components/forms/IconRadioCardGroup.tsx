import { Button, Circle, Grid, HStack, Icon, Stack, Text } from "@chakra-ui/react";
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
  maxColumns?: number;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

export const IconRadioCardGroup = <T extends string = string>({
  items,
  value,
  onChange,
  direction: layout = "horizontal",
  maxColumns,
  ariaLabel,
  ariaLabelledBy,
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
          const radios =
            groupRef.current?.querySelectorAll<HTMLElement>(
              '[role="radio"] button, button[role="radio"]',
            );
          radios?.[nextIndex]?.focus();
        }
      }
    },
    [items, onChange],
  );

  const renderItem = (item: IconListItem<T>, index: number) => {
    const isSelected = value === item.value;
    const isTabbable =
      isSelected || (value === undefined && index === 0);

    return (
      <Button
        key={item.value}
        variant="plain"
        role="radio"
        aria-checked={isSelected}
        onClick={() => onChange(item.value)}
        cursor="pointer"
        borderWidth="1px"
        borderColor={isSelected ? "orange.emphasized" : "border.subtle"}
        borderRadius="xl"
        bg={isSelected ? "orange.subtle" : "bg.panel"}
        py="3"
        px={isSelected ? "5" : "3"}
        h="auto"
        transition="all 0.2s ease"
        boxShadow={isSelected ? "0 0 0 1px var(--colors-orange-muted)" : "none"}
        position="relative"
        _hover={{
          borderColor: isSelected ? "orange.emphasized" : "border.emphasized",
          bg: isSelected ? "orange.subtle" : "bg.muted",
          boxShadow: isSelected
            ? "0 0 0 1px var(--colors-orange-muted)"
            : "sm",
          transform: "translateY(-1px)",
          zIndex: 1,
        }}
        w="full"
        minW="0"
        textAlign="start"
        tabIndex={isTabbable ? 0 : -1}
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
              color={{ base: "fg.DEFAULT", _dark: "white" }}
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
      </Button>
    );
  };

  if (isHorizontal) {
    const cols = maxColumns ? Math.min(items.length, maxColumns) : items.length;
    return (
      <Grid
        ref={groupRef}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        templateColumns={{
          base: "1fr",
          md: `repeat(${cols}, 1fr)`,
        }}
        gap="2"
        w="full"
        p="1"
        m="-1"
      >
        {items.map(renderItem)}
      </Grid>
    );
  }

  return (
    <Stack
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      direction="column"
      gap="2"
      w="full"
      p="1"
      m="-1"
    >
      {items.map(renderItem)}
    </Stack>
  );
};

export default IconRadioCardGroup;
