import { CheckboxCard, Box, HStack, Text } from "@langwatch/design-system/primitives";
import { type FacetDisplayState, isGroupedState } from "@langwatch/trace-contract";
import { memo } from "react";

import { hashColor } from "../../../../model/display-formatters.ts";
import {
  InGroupLabel,
  inGroupStateLabel,
  inGroupTitle,
} from "../../../elements/explorer/filter-sidebar/in-group-label.tsx";
import { paletteFromColor } from "./utils.ts";

function attributeCheckedState(state: FacetDisplayState): boolean | "indeterminate" {
  if (state === "include") return true;
  if (state === "exclude") return "indeterminate";
  return false;
}

function attributeStateLabel(state: FacetDisplayState): string {
  if (state === "include") return "included";
  if (state === "exclude") return "excluded";
  if (isGroupedState(state)) return inGroupStateLabel(state);
  return "click to include";
}

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
  state: FacetDisplayState;
  onToggle: (attrKey: string, value: string) => void;
}) {
  const isInclude = state === "include";
  const isExclude = state === "exclude";
  const isActive = isInclude || isExclude;
  const isGrouped = isGroupedState(state);

  const palette = paletteFromColor(hashColor(value));
  const barBg = isExclude ? "red.subtle" : `${palette}.subtle`;
  const labelColor = isExclude ? "red.fg" : `${palette}.fg`;

  return (
    <CheckboxCard.Root
      unstyled
      checked={attributeCheckedState(state)}
      onCheckedChange={() => onToggle(attrKey, value)}
      title={isGrouped ? inGroupTitle(state) : undefined}
      data-state={state}
      display="block"
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
      _hover={{
        "& [data-facet-label]": {
          color: labelColor,
          fontWeight: isActive ? 700 : 600,
        },
        "& [data-facet-bar]": {
          opacity: 1,
        },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <CheckboxCard.HiddenInput aria-label={`${label} — ${attributeStateLabel(state)}`} />
      <Box
        data-facet-bar
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        width="100%"
        bg={barBg}
        opacity={isActive ? 1 : 0.5}
        pointerEvents="none"
        transition="opacity 120ms ease, background 120ms ease"
      />
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        {/* First, not last: long attribute values run past the sidebar edge and would hide it. */}
        {isGrouped && <InGroupLabel />}
        <Text
          textStyle="xs"
          fontWeight={isActive ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          data-facet-label
          color={labelColor}
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {label}
        </Text>
      </HStack>
    </CheckboxCard.Root>
  );
});
