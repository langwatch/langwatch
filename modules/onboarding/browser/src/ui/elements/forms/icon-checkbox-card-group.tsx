import { CheckboxCard, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Check } from "lucide-react";
import type React from "react";

type IconListItem<T> = {
  title: string;
  value: T;
  icon: React.ComponentType;
};

interface IconCheckboxCardGroupProps<T extends string = string> {
  items: IconListItem<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  label?: string;
  ariaLabel?: string;
}

export const IconCheckboxCardGroup = <T extends string = string>({
  items,
  value,
  onChange,
  label,
  ariaLabel,
}: IconCheckboxCardGroupProps<T>) => {
  const toggle = (item: T) => {
    onChange(value.includes(item) ? value.filter((v) => v !== item) : [...value, item]);
  };

  return (
    <VStack as="fieldset" aria-label={ariaLabel ?? label} gap="2" w="full" p="1" m="-1">
      {label && (
        <Text textStyle="sm" fontWeight="medium">
          {label}
        </Text>
      )}
      {items.map((item) => {
        const isSelected = value.includes(item.value);
        return (
          <CheckboxCard.Root
            key={item.value}
            unstyled
            checked={isSelected}
            onCheckedChange={() => toggle(item.value)}
            display="flex"
            alignItems="center"
            cursor="pointer"
            userSelect="none"
            focusVisibleRing="outside"
            borderWidth="1px"
            borderColor={isSelected ? "orange.emphasized" : "border.subtle"}
            borderRadius="xl"
            bg={isSelected ? "orange.subtle" : "bg.panel"}
            py="3"
            px={isSelected ? "5" : "3"}
            transition="all 0.2s ease"
            boxShadow={isSelected ? "0 0 0 1px var(--colors-orange-muted)" : "none"}
            position="relative"
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
            <CheckboxCard.HiddenInput />
            <HStack align="center" justify="space-between" w="full" minW="0">
              <HStack align="center" gap="2" minW="0" flex="1">
                <Icon
                  size="sm"
                  color={isSelected ? "orange.fg" : "fg.muted"}
                  transition="color 0.15s ease"
                  flexShrink={0}
                >
                  <item.icon />
                </Icon>
                <Text textStyle="sm" fontWeight="medium" color="fg" truncate>
                  {item.title}
                </Text>
              </HStack>

              <HStack
                w="4"
                h="4"
                borderRadius="4px"
                borderWidth="1px"
                borderColor={isSelected ? "orange.solid" : "border.emphasized"}
                bg={isSelected ? "orange.solid" : "bg.surface"}
                align="center"
                justify="center"
                transition="all 0.15s ease"
                flexShrink={0}
              >
                {isSelected && <Check size={10} color="white" strokeWidth={3} />}
              </HStack>
            </HStack>
          </CheckboxCard.Root>
        );
      })}
    </VStack>
  );
};

export default IconCheckboxCardGroup;
