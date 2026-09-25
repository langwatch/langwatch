import { chakra, Box, type IconProps, Text, VStack } from "@chakra-ui/react";
import { useColorModeValue } from "@langwatch/design-system/color-mode";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type React from "react";

import { type IconSizeKey, iconSizeToPixels } from "../../../model/icon-size.ts";
import {
  SELECTED_SURFACE_BG,
  SELECTED_SURFACE_BORDER,
} from "../../../model/shared/accent-surface.ts";
import type { IconData } from "../../../model/shared/types.ts";

interface SelectableIconCardProps {
  label: string;
  size?: "sm" | "md";
  icon?: IconData;
  /** An already-rendered glyph, for callers whose icons are components. */
  iconNode?: React.ReactNode;
  iconSize?: IconProps["size"];
  selected: boolean;
  onClick: () => void;
  ariaLabel: string;
  /** A small chip riding the card's top edge (e.g. "Recommended"). */
  badge?: string;
}

function SelectableIconBadge({ badge }: { badge?: string }): React.ReactElement | null {
  if (!badge) return null;

  return (
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
      color="white"
      whiteSpace="nowrap"
      pointerEvents="none"
    >
      {badge}
    </Text>
  );
}

function IconContent({
  icon,
  iconNode,
  iconSrc,
  iconAlt,
  iconLabel,
  resolvedSize,
  size,
  label,
}: {
  icon?: IconData;
  iconNode?: React.ReactNode;
  iconSrc?: string;
  iconAlt?: string;
  iconLabel?: string;
  resolvedSize: string;
  size: "sm" | "md";
  label: string;
}): React.ReactElement {
  if (iconNode) {
    return (
      <Box
        w={resolvedSize}
        h={resolvedSize}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {iconNode}
      </Box>
    );
  }

  if (!icon) {
    return (
      <Text textStyle="sm" fontWeight="normal" color="fg.muted" textAlign="center">
        {label}
      </Text>
    );
  }

  return (
    <>
      {iconSrc ? (
        <img
          src={iconSrc}
          alt={iconAlt}
          style={{
            width: resolvedSize,
            height: resolvedSize,
            objectFit: "contain",
            display: "block",
          }}
        />
      ) : (
        <Box w={resolvedSize} h={resolvedSize} aria-hidden />
      )}
      {iconLabel && (
        <Text
          textStyle={size === "sm" ? "2xs" : "xs"}
          fontWeight="medium"
          color="fg.muted"
          textAlign="center"
          lineHeight="tight"
        >
          {iconLabel}
        </Text>
      )}
    </>
  );
}

export function SelectableIconCard(props: SelectableIconCardProps): React.ReactElement {
  const {
    label,
    size = "md",
    icon,
    iconNode,
    iconSize,
    selected,
    onClick,
    ariaLabel,
    badge,
  } = props;

  const actualIcon = icon?.type === "with-label" ? icon.icon : icon;
  const iconLabel = icon?.type === "with-label" ? icon.label : undefined;

  const resolvedSize = iconSizeToPixels[(iconSize ?? "md") as IconSizeKey] ?? "24px";

  const themedIconSrc = useColorModeValue(
    actualIcon?.type === "themed" ? actualIcon.lightSrc : "",
    actualIcon?.type === "themed" ? actualIcon.darkSrc : "",
  );
  const selectedBorderColor = useColorModeValue(
    SELECTED_SURFACE_BORDER.light,
    SELECTED_SURFACE_BORDER.dark,
  );
  const selectedBg = useColorModeValue(SELECTED_SURFACE_BG.light, SELECTED_SURFACE_BG.dark);
  const isDark = useColorModeValue(false, true);

  const iconSrc = actualIcon?.type === "themed" ? themedIconSrc : actualIcon?.src;
  const iconAlt = actualIcon?.alt;

  const cardSize = size === "sm" ? "72px" : "96px";
  const selectedShadow = isDark
    ? "0 6px 28px rgba(237,137,38,0.06)"
    : "0 0 0 1px var(--chakra-colors-orange-100)";
  const hoverSelectedBorder = isDark ? "orange.emphasized" : selectedBorderColor;

  return (
    <Tooltip content={label} positioning={{ placement: "bottom" }} showArrow openDelay={0}>
      <chakra.button
        type="button"
        // Fold the badge into the accessible name — aria-label overrides the
        // subtree, so the "Recommended" chip is otherwise invisible to
        // assistive tech that sighted users can see.
        aria-label={badge ? `${ariaLabel}, ${badge}` : ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        cursor="pointer"
        position="relative"
        w={cardSize}
        h={cardSize}
        flexShrink={0}
        borderRadius="lg"
        borderWidth={cardBorderWidth({ isDark, selected })}
        borderStyle="solid"
        borderColor={selected ? selectedBorderColor : "border.subtle"}
        bg={selected ? selectedBg : "bg.panel"}
        boxShadow={selected ? selectedShadow : "none"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        transition="all 0.2s ease"
        _hover={{
          borderColor: selected ? hoverSelectedBorder : "border.emphasized",
          bg: selected ? selectedBg : unselectedHoverBg(isDark),
          boxShadow: selected ? selectedShadow : "sm",
          transform: "translateY(-1px)",
        }}
      >
        <SelectableIconBadge badge={badge} />
        <VStack
          gap={iconLabel ? 1 : 0}
          align="center"
          justify="center"
          style={{
            filter: selected ? "grayscale(0%)" : "grayscale(100%)",
            transition: "filter 0.2s ease",
          }}
        >
          <IconContent
            icon={icon}
            iconNode={iconNode}
            iconSrc={iconSrc}
            iconAlt={iconAlt}
            iconLabel={iconLabel}
            resolvedSize={resolvedSize}
            size={size}
            label={label}
          />
        </VStack>
      </chakra.button>
    </Tooltip>
  );
}

function cardBorderWidth({ isDark, selected }: { isDark: boolean; selected: boolean }): string {
  if (isDark) return "1px";
  return selected ? "2px" : "1px";
}

function unselectedHoverBg(isDark: boolean): string {
  return isDark ? "bg.muted" : "gray.50";
}
