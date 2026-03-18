import {
  Box,
  Card,
  Icon,
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

  // Extract the actual icon from IconWithLabel if needed
  const actualIcon = icon?.type === "with-label" ? icon.icon : icon;
  const iconLabel = icon?.type === "with-label" ? icon.label : undefined;

  const themedIconSrc = useColorModeValue(
    actualIcon?.type === "themed" ? actualIcon.lightSrc : "",
    actualIcon?.type === "themed" ? actualIcon.darkSrc : "",
  );
  const borderColor = "border.muted";
  const selectedBorderColor = useColorModeValue("orange.400", "orange.300");
  const selectedBg = useColorModeValue("orange.50", "orange.950/30");

  const iconSrc =
    actualIcon?.type === "themed" ? themedIconSrc : actualIcon?.src;
  const iconAlt = actualIcon?.alt;

  return (
    <Tooltip
      content={label}
      positioning={{ placement: "bottom" }}
      showArrow
      openDelay={0}
    >
      <Card.Root
        role="button"
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        cursor="pointer"
        borderWidth={selected ? "2px" : "1px"}
        borderColor={
          selected ? selectedBorderColor : "rgba(0,0,0,0.08)"
        }
        bg={selected ? selectedBg : "rgba(0,0,0,0.03)"}
        backdropFilter="blur(16px) saturate(1.3)"
        boxShadow={
          selected
            ? undefined
            : "0 2px 12px rgba(0,0,0,0.04), inset 0 1px 0 white"
        }
        transition="all 0.2s ease"
        _hover={{
          borderColor: selected
            ? selectedBorderColor
            : "rgba(0,0,0,0.14)",
          boxShadow: selected
            ? undefined
            : "0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 white",
          transform: "translateY(-1px)",
        }}
        aspectRatio="1 / 1"
        display="flex"
        maxW={size === "sm" ? "75px" : "100px"}
        minW={size === "sm" ? "65px" : "90px"}
        alignItems="center"
        justifyContent="center"
      >
        <VStack
          filter={selected ? "grayscale(0%)" : "grayscale(100%)"}
          transition="filter 0.2s ease"
          alignItems="center"
          justifyContent="center"
          gap={iconLabel ? "0px" : "0"}
        >
          {icon ? (
            <>
              <Icon size={iconSize ?? "md"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={iconSrc} alt={iconAlt} />
              </Icon>
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
      </Card.Root>
    </Tooltip>
  );
}
