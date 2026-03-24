import { Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
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
  size?: "sm" | "md" | "lg";
  label?: string;
}

export const IconCheckboxCardGroup = <T extends string = string>({
  items,
  value,
  onChange,
  label,
}: IconCheckboxCardGroupProps<T>) => {
  const toggle = (item: T) => {
    onChange(
      value.includes(item) ? value.filter((v) => v !== item) : [...value, item],
    );
  };

  return (
    <VStack gap="2" w="full" p="1" m="-1">
      {label && (
        <Text textStyle="sm" fontWeight="medium">
          {label}
        </Text>
      )}
      {items.map((item) => {
        const isSelected = value.includes(item.value);
        return (
          <Button
            key={item.value}
            variant="unstyled"
            role="checkbox"
            aria-checked={isSelected}
            onClick={() => toggle(item.value)}
            cursor="pointer"
            borderWidth="1px"
            borderColor={isSelected ? "orange.emphasized" : "border.subtle"}
            borderRadius="xl"
            bg={isSelected ? "orange.subtle" : "bg.panel"}
            p="3"
            h="auto"
            transition="all 0.2s ease"
            boxShadow={
              isSelected ? "0 0 0 1px var(--colors-orange-muted)" : "none"
            }
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
          >
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
                <Text
                  textStyle="sm"
                  fontWeight="medium"
                  color="fg.DEFAULT"
                  truncate
                >
                  {item.title}
                </Text>
              </HStack>

              <HStack
                w="4"
                h="4"
                borderRadius="4px"
                borderWidth="1px"
                borderColor={
                  isSelected ? "orange.solid" : "border.emphasized"
                }
                bg={isSelected ? "orange.solid" : "bg.surface"}
                align="center"
                justify="center"
                transition="all 0.15s ease"
                flexShrink={0}
              >
                {isSelected && <Check size={10} color="white" strokeWidth={3} />}
              </HStack>
            </HStack>
          </Button>
        );
      })}
    </VStack>
  );
};

export default IconCheckboxCardGroup;
