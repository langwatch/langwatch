import { CheckboxCard, HStack, Text } from "@chakra-ui/react";
import type React from "react";

export const NoneAttributeRow: React.FC<{
  active: boolean;
  onToggle: () => void;
}> = ({ active, onToggle }) => (
  <CheckboxCard.Root
    unstyled
    checked={active}
    onCheckedChange={() => onToggle()}
    display="block"
    position="relative"
    width="full"
    paddingY={1}
    paddingX={1.5}
    cursor="pointer"
    textAlign="left"
    borderRadius="sm"
    overflow="hidden"
    background={active ? "gray.solid" : "transparent"}
    border="none"
    _hover={{
      background: active ? "gray.solid" : "gray.subtle",
      "& [data-facet-label]": active ? { fontWeight: 700 } : { color: "fg", fontWeight: 500 },
    }}
    _focusVisible={{
      outline: "2px solid",
      outlineColor: "blue.focusRing",
      outlineOffset: "-2px",
    }}
  >
    <CheckboxCard.HiddenInput />
    <HStack gap={1.5} minWidth={0}>
      <Text
        textStyle="xs"
        fontStyle="italic"
        fontWeight={active ? "600" : "400"}
        color={active ? "white" : "fg.subtle"}
        data-facet-label
      >
        (none)
      </Text>
    </HStack>
  </CheckboxCard.Root>
);
