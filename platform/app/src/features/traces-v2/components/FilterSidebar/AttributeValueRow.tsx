import { Box, HStack, Text } from "@chakra-ui/react";
import { memo } from "react";
import { hashColor } from "../../utils/formatters";
import { RowButton } from "./RowButton";
import type { FacetValueState } from "./types";
import { paletteFromColor } from "./utils";

export const AttributeValueRow = memo(function AttributeValueRow({
  attrKey,
  value,
  label,
  state,
  onToggle,
}: {
  attrKey: string;
  value: string;
  label: string;
  state: FacetValueState;
  onToggle: (attrKey: string, value: string) => void;
}) {
  const isInclude = state === "include";
  const isExclude = state === "exclude";
  const isActive = isInclude || isExclude;

  const palette = paletteFromColor(hashColor(value));
  const barBg = isExclude ? "red.solid" : `${palette}.solid`;

  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={isInclude ? true : isExclude ? "mixed" : false}
      position="relative"
      width="full"
      paddingY={1}
      paddingX={1.5}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background="transparent"
      border="none"
      onClick={() => onToggle(attrKey, value)}
      _hover={{
        "& [data-facet-label]": {
          color: "white",
          fontWeight: isActive ? 700 : 600,
        },
        "& [data-facet-bar]": {
          opacity: isActive ? 0.6 : 0.35,
        },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        data-facet-bar
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        width="100%"
        bg={barBg}
        opacity={isActive ? 0.45 : 0.2}
        pointerEvents="none"
        transition="opacity 120ms ease, background 120ms ease"
      />
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Text
          textStyle="xs"
          fontWeight={isActive ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          data-facet-label
          color="white"
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {label}
        </Text>
      </HStack>
    </RowButton>
  );
});
