import { HStack, Icon, RadioCard, Stack } from "@chakra-ui/react";
import type React from "react";

type IconListItem<T> = {
  title: string;
  value: T;
  icon: React.ComponentType;
};

interface IconRadioCardGroupProps<T extends string = string> {
  items: IconListItem<T>[];
  value?: T;
  onChange: (value: T | undefined) => void;
  direction?: "horizontal" | "vertical";
  size?: "sm" | "md" | "lg";
  variant?: "outline";
}

export const IconRadioCardGroup = <T extends string = string>({
  items,
  value,
  onChange,
  direction: layout = "horizontal",
  size = "sm",
  variant = "outline",
}: IconRadioCardGroupProps<T>) => (
  <RadioCard.Root
    size={size}
    variant={variant}
    w="full"
    value={value}
    onValueChange={({ value }) =>
      onChange(value === null ? void 0 : (value as T))
    }
    colorPalette="orange"
  >
    <Stack
      align="stretch"
      direction={{
        base: "column",
        md: layout === "horizontal" ? "row" : "column",
      }}
    >
      {items.map((item) => (
        <RadioCard.Item key={item.value} value={item.value}>
          <RadioCard.ItemHiddenInput />
          <RadioCard.ItemControl>
            <RadioCard.ItemContent>
              <HStack align="center" justify="space-between" w="full">
                <HStack align="center" justify="center">
                  <Icon size="sm" color="fg.muted">
                    <item.icon />
                  </Icon>
                  <RadioCard.ItemText>{item.title}</RadioCard.ItemText>
                </HStack>
                <RadioCard.ItemIndicator />
              </HStack>
            </RadioCard.ItemContent>
          </RadioCard.ItemControl>
        </RadioCard.Item>
      ))}
    </Stack>
  </RadioCard.Root>
);

export default IconRadioCardGroup;
