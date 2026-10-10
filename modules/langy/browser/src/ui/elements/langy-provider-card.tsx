/**
 * One provider in Langy's model setup: a small square with the provider's mark, grey until
 * picked, its name in a tooltip, and an optional chip on its top edge ("Recommended").
 */
import { useColorModeValue } from "@langwatch/design-system/color-mode";
import { Box, chakra, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { ReactNode } from "react";

const CARD_SIZE = "72px";
const MARK_SIZE = "32px";

export function LangyProviderCard({
  label,
  mark,
  selected,
  badge,
  onClick,
}: {
  label: string;
  mark: ReactNode;
  selected: boolean;
  badge?: string;
  onClick: () => void;
}) {
  const selectedBorder = useColorModeValue("accent.emphasized", "accent.emphasized");
  const selectedBg = useColorModeValue("accent.subtle", "accent.subtle");
  const isDark = useColorModeValue(false, true);
  const hoverBorder = useColorModeValue(selectedBorder, "orange.emphasized");
  const hoverBg = useColorModeValue("bg.subtle", "bg.muted");
  const selectedShadow = isDark
    ? "0 6px 28px color-mix(in srgb, var(--chakra-colors-accent-solid) 6%, transparent)"
    : "0 0 0 1px var(--chakra-colors-accent-muted)";

  return (
    <Tooltip content={label} positioning={{ placement: "bottom" }} showArrow openDelay={0}>
      <chakra.button
        type="button"
        aria-label={badge ? `${label}, ${badge}` : label}
        aria-pressed={selected}
        onClick={onClick}
        cursor="pointer"
        position="relative"
        w={CARD_SIZE}
        h={CARD_SIZE}
        flexShrink={0}
        borderRadius="lg"
        borderWidth={!isDark && selected ? "2px" : "1px"}
        borderStyle="solid"
        borderColor={selected ? selectedBorder : "border.subtle"}
        bg={selected ? selectedBg : "bg.panel"}
        boxShadow={selected ? selectedShadow : "none"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        transition="all 0.2s ease"
        _hover={{
          borderColor: selected ? hoverBorder : "border.emphasized",
          bg: selected ? selectedBg : hoverBg,
          boxShadow: selected ? selectedShadow : "sm",
          transform: "translateY(-1px)",
        }}
      >
        {badge ? (
          <Text
            position="absolute"
            top="-8px"
            left="50%"
            transform="translateX(-50%)"
            fontSize="9px"
            fontWeight="600"
            letterSpacing="0.02em"
            lineHeight="1"
            paddingX={1.5}
            paddingY="3px"
            borderRadius="full"
            background="orange.solid"
            color="orange.contrast"
            whiteSpace="nowrap"
            pointerEvents="none"
          >
            {badge}
          </Text>
        ) : null}
        <Box
          w={MARK_SIZE}
          h={MARK_SIZE}
          display="flex"
          alignItems="center"
          justifyContent="center"
          css={{ "& > svg": { w: "full", h: "full" } }}
          style={{
            filter: selected ? "grayscale(0%)" : "grayscale(100%)",
            transition: "filter 0.2s ease",
          }}
        >
          {mark}
        </Box>
      </chakra.button>
    </Tooltip>
  );
}
