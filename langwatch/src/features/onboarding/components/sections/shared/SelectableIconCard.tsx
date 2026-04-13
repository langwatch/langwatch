import {
  Box,
  type IconProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useColorModeValue } from "../../../../../components/ui/color-mode";
import { Tooltip } from "../../../../../components/ui/tooltip";
import type { IconData } from "../../../regions/shared/types";

interface SelectableIconCardProps {
  label: string;
  size?: "sm" | "md";
  icon?: IconData;
  iconSize?: IconProps["size"];
  selected: boolean;
  onClick: () => void;
  ariaLabel: string;
}

const iconSizeToPixels = {
  xs: "12px",
  sm: "16px",
  md: "24px",
  lg: "32px",
  xl: "40px",
  "2xl": "48px",
} as const;

type IconSizeKey = keyof typeof iconSizeToPixels;

export function SelectableIconCard(
  props: SelectableIconCardProps,
): React.ReactElement {
  const {
    label,
    size = "md",
    icon,
    iconSize,
    selected,
    onClick,
    ariaLabel,
  } = props;

  const actualIcon = icon?.type === "with-label" ? icon.icon : icon;
  const iconLabel = icon?.type === "with-label" ? icon.label : undefined;

  const resolvedSize =
    iconSizeToPixels[(iconSize ?? "md") as IconSizeKey] ?? "24px";

  const themedIconSrc = useColorModeValue(
    actualIcon?.type === "themed" ? actualIcon.lightSrc : "",
    actualIcon?.type === "themed" ? actualIcon.darkSrc : "",
  );
  const selectedBorderColor = useColorModeValue("orange.400", "orange.800");
  const selectedBg = useColorModeValue("orange.50", "orange.950/30");
  const isDark = useColorModeValue(false, true);

  const iconSrc =
    actualIcon?.type === "themed" ? themedIconSrc : actualIcon?.src;
  const iconAlt = actualIcon?.alt;

  const cardSize = size === "sm" ? "72px" : "96px";

  return (
    <Tooltip
      content={label}
      positioning={{ placement: "bottom" }}
      showArrow
      openDelay={0}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        cursor="pointer"
        w={cardSize}
        h={cardSize}
        flexShrink={0}
        borderRadius="lg"
        borderWidth={isDark ? "1px" : selected ? "2px" : "1px"}
        borderStyle="solid"
        borderColor={selected ? selectedBorderColor : "border.subtle"}
        bg={selected ? selectedBg : "bg.panel"}
        boxShadow={
          selected
            ? isDark
              ? "0 6px 28px rgba(237,137,38,0.06)"
              : "0 0 0 1px var(--chakra-colors-orange-100)"
            : "none"
        }
        display="flex"
        alignItems="center"
        justifyContent="center"
        transition="all 0.2s ease"
        _hover={{
          borderColor: selected
            ? isDark
              ? "orange.emphasized"
              : selectedBorderColor
            : "border.emphasized",
          bg: selected ? selectedBg : isDark ? "bg.muted" : "gray.50",
          boxShadow: selected
            ? isDark
              ? "0 6px 28px rgba(237,137,38,0.06)"
              : "0 0 0 1px var(--chakra-colors-orange-100)"
            : "sm",
          transform: "translateY(-1px)",
        }}
      >
        <VStack
          gap={iconLabel ? 1 : 0}
          align="center"
          justify="center"
          style={{ filter: selected ? "grayscale(0%)" : "grayscale(100%)", transition: "filter 0.2s ease" }}
        >
          {icon ? (
            <>
              {iconSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={iconSrc}
                  alt={iconAlt}
                  style={{ width: resolvedSize, height: resolvedSize, objectFit: "contain", display: "block" }}
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
          ) : (
            <Text
              textStyle="sm"
              fontWeight="normal"
              color="fg.muted"
              textAlign="center"
            >
              {label}
            </Text>
          )}
        </VStack>
      </Box>
    </Tooltip>
  );
}
