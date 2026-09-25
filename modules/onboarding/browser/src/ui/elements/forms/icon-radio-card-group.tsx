import { Circle, HStack, Icon, RadioCard, Text } from "@chakra-ui/react";
import type React from "react";

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
  const cols = maxColumns ? Math.min(items.length, maxColumns) : items.length;
  const columns =
    layout === "horizontal" ? { base: "1fr", md: `repeat(${cols}, 1fr)` } : { base: "1fr" };

  return (
    <RadioCard.Root
      unstyled
      value={value ?? null}
      onValueChange={(details) =>
        onChange(items.find((item) => item.value === details.value)?.value)
      }
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      display="grid"
      gridTemplateColumns={columns}
      gap="2"
      w="full"
      p="1"
      m="-1"
    >
      {items.map((item) => {
        const isSelected = value === item.value;
        return (
          <RadioCard.Item
            key={item.value}
            value={item.value}
            unstyled
            display="flex"
            alignItems="center"
            cursor="pointer"
            userSelect="none"
            borderWidth="1px"
            borderColor={isSelected ? "orange.emphasized" : "border.subtle"}
            borderRadius="xl"
            bg={isSelected ? "orange.subtle" : "bg.panel"}
            py="3"
            px={isSelected ? "5" : "3"}
            transition="all 0.2s ease"
            boxShadow={isSelected ? "0 0 0 1px var(--colors-orange-muted)" : "none"}
            position="relative"
            focusVisibleRing="outside"
            _hover={{
              borderColor: isSelected ? "orange.emphasized" : "border.emphasized",
              bg: isSelected ? "orange.subtle" : "bg.muted",
              boxShadow: isSelected ? "0 0 0 1px var(--colors-orange-muted)" : "sm",
              transform: "translateY(-1px)",
              zIndex: 1,
            }}
            w="full"
            minW="0"
            textAlign="start"
          >
            <RadioCard.ItemHiddenInput />
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
                  color={{ base: "black", _dark: "white" }}
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
          </RadioCard.Item>
        );
      })}
    </RadioCard.Root>
  );
};

export default IconRadioCardGroup;
