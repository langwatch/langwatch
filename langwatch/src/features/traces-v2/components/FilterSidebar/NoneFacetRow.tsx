import { Box, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { memo } from "react";
import { RowButton } from "./RowButton";

export const NoneFacetRow = memo(function NoneFacetRow({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-label={
        active ? "Filtering for missing values" : "Show missing values only"
      }
      position="relative"
      width="full"
      paddingY={1}
      paddingLeft={1.5}
      paddingRight={0}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background={active ? "bg.subtle" : "transparent"}
      borderWidth={0}
      data-state={active ? "include" : "neutral"}
      onClick={onToggle}
      transition="background 120ms ease, border-color 120ms ease"
      _hover={{
        background: active ? "bg.subtle" : "bg.muted",
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      {active && (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width="2px"
          bg="gray.solid"
          pointerEvents="none"
        />
      )}
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Box
          width="8px"
          height="8px"
          borderRadius="full"
          borderWidth="1px"
          borderStyle="dashed"
          borderColor="fg.subtle"
          flexShrink={0}
        />
        <Text
          textStyle="xs"
          fontStyle="italic"
          fontWeight={active ? "600" : "400"}
          truncate
          flex={1}
          minWidth={0}
          color={active ? "fg" : "fg.subtle"}
        >
          (none)
        </Text>
      </HStack>
    </RowButton>
  );
});
