import { Box, Circle, Grid, HStack, Icon, Stack, Text } from "@chakra-ui/react";
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

  const renderItem = (item: IconListItem<T>) => {
    const isSelected = value === item.value;

    return (
      <Box
        key={item.value}
        asChild
        role="radio"
        aria-checked={isSelected}
        onClick={() => onChange(isSelected ? undefined : item.value)}
        cursor="pointer"
        borderWidth="1px"
        borderColor={isSelected ? "orange.400" : "rgba(0,0,0,0.08)"}
        borderRadius="10px"
        bg={isSelected ? "orange.subtle" : "white"}
        p="3"
        transition="border-color 0.15s ease, background 0.15s ease"
        _hover={{
          borderColor: isSelected ? "orange.400" : "rgba(0,0,0,0.14)",
        }}
        w="full"
        minW="0"
        textAlign="start"
      >
        <button type="button">
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
    <Stack direction="column" gap="2" w="full">
      {items.map(renderItem)}
    </Stack>
  );
};

export default IconRadioCardGroup;
