import { Badge, Box, HStack, Text } from "@chakra-ui/react";
import { memo } from "react";
import { RowButton } from "./RowButton";
import type { FacetItem, FacetValueState } from "./types";
import { formatCount, paletteFromColor } from "./utils";

const TYPED_LABEL_REGEX = /^\[([^\]]+)\]\s*(.+)$/;

function parseTypedLabel(label: string): { typeTag?: string; text: string } {
  const match = TYPED_LABEL_REGEX.exec(label);
  if (!match) return { text: label };
  return { typeTag: match[1], text: match[2]! };
}

const MIN_VISIBLE_FILL_PCT = 4;

export const FacetRow = memo(function FacetRow({
  item,
  state,
  maxCount,
  onToggle,
}: {
  item: FacetItem;
  state: FacetValueState;
  maxCount: number;
  onToggle: (value: string) => void;
}) {
  const { typeTag, text } = parseTypedLabel(item.label);

  const fillPct =
    maxCount > 0
      ? Math.max(
          (item.count / maxCount) * 100,
          item.count > 0 ? MIN_VISIBLE_FILL_PCT : 0,
        )
      : 0;

  const isInclude = state === "include";
  const isExclude = state === "exclude";
  const isActive = isInclude || isExclude;

  const palette = isExclude ? "red" : paletteFromColor(item.dotColor);
  const orbOpacity = item.dimmed ? (isActive ? 0.85 : 0.55) : 1;

  const ariaChecked = isInclude ? true : isExclude ? "mixed" : false;
  const ariaLabel = `${item.label} — ${
    isInclude ? "included" : isExclude ? "excluded" : "click to include"
  }`;

  const subtleBg = `${palette}.subtle`;
  const solidBar = `${palette}.solid`;

  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={ariaChecked}
      aria-label={ariaLabel}
      position="relative"
      width="full"
      paddingY={1}
      paddingLeft={1.5}
      paddingRight={0}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background={isActive ? subtleBg : "transparent"}
      borderWidth={0}
      data-state={state}
      onClick={() => onToggle(item.value)}
      transition="background 120ms ease, border-color 120ms ease"
      _hover={{
        background: isActive ? subtleBg : "bg.muted",
        "& [data-facet-orb]": {
          opacity: 1,
          transform: "scale(1.15)",
        },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width={`${fillPct}%`}
        height="2px"
        bg={solidBar}
        opacity={item.dimmed ? 0.35 : 0.55}
        pointerEvents="none"
        transition="width 120ms ease"
      />
      {isActive && (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width="2px"
          bg={solidBar}
          pointerEvents="none"
        />
      )}
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Box
          data-facet-orb
          width="8px"
          height="8px"
          borderRadius="full"
          bg={solidBar}
          opacity={orbOpacity}
          flexShrink={0}
          transition="opacity 120ms ease, transform 120ms ease"
        />
        {typeTag && (
          <Badge
            size="xs"
            variant="outline"
            color="fg.subtle"
            paddingX={1}
            flexShrink={0}
            textTransform="lowercase"
            fontFamily="mono"
            fontWeight="500"
          >
            {typeTag}
          </Badge>
        )}
        <Text
          textStyle="xs"
          fontWeight={isActive ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          color={isActive ? "fg" : "fg.muted"}
          textDecoration={isExclude ? "line-through" : undefined}
        >
          {text}
        </Text>
        <Text
          textStyle="xs"
          color="fg.subtle"
          fontFamily="mono"
          mr={2}
          fontWeight={isActive ? "600" : "400"}
          flexShrink={0}
        >
          {formatCount(item.count)}
        </Text>
      </HStack>
    </RowButton>
  );
});
