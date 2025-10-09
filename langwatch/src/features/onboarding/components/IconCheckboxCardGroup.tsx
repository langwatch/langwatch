import React from "react";
import {
  HStack,
  VStack,
  Icon,
  CheckboxCard,
  Text,
} from "@chakra-ui/react";
import { CheckboxGroup } from "../../../components/ui/checkbox";
import type { IconFormItem } from "../types/types";

interface IconCheckboxCardGroupProps<T extends string = string> {
  items: IconFormItem[];
  value: T[];
  onChange: (value: T[]) => void;
  size?: "sm" | "md" | "lg";
  label?: string;
}

export const IconCheckboxCardGroup = <T extends string = string>({
  items,
  value,
  onChange,
  label,
  size = "sm",
}: IconCheckboxCardGroupProps<T>) => (
  <CheckboxGroup
    colorPalette="orange"
    w={"full"}
    value={value}
    onValueChange={value => {
      onChange(value as T[]);
    }}
  >
    {label && (
      <Text textStyle={size} fontWeight="medium">{label}</Text>
    )}
    <VStack gap="2" w="full">
      {items.map((item) => (
        <CheckboxCard.Root
          key={item.value}
          value={item.value}
          size={size}
          w="full"
          colorPalette="orange"
        >
          <CheckboxCard.HiddenInput />
          <CheckboxCard.Control>
            <HStack align="center" justify="space-between" w="full">
              <CheckboxCard.Content>
                <HStack>
                  <Icon size="sm" color="fg.muted">
                    <item.icon />
                  </Icon>
                  <CheckboxCard.Label>
                    {item.title}
                  </CheckboxCard.Label>
                </HStack>
              </CheckboxCard.Content>
              <CheckboxCard.Indicator />
            </HStack>
          </CheckboxCard.Control>
        </CheckboxCard.Root>
      ))}
    </VStack>
  </CheckboxGroup>
);
