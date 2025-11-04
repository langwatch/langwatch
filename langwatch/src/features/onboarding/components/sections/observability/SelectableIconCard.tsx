import React from "react";
import { Box, Card, Icon, Text, type IconProps } from "@chakra-ui/react";
import { useColorModeValue } from "../../../../../components/ui/color-mode";
import { Tooltip } from "../../../../../components/ui/tooltip";
import type { IconData } from "../../../regions/observability/codegen/registry";

interface SelectableIconCardProps {
  label: string;
  icon?: IconData;
  size?: IconProps["size"];
  selected: boolean;
  onClick: () => void;
  ariaLabel: string;
}

export function SelectableIconCard(props: SelectableIconCardProps): React.ReactElement {
  const { label, icon, size, selected, onClick, ariaLabel } = props;
  const themedIconSrc = useColorModeValue(
    icon?.type === "themed" ? icon.lightSrc : "",
    icon?.type === "themed" ? icon.darkSrc : ""
  );

  const iconSrc = icon?.type === "themed" ? themedIconSrc : icon?.src;
  const iconAlt = icon?.alt;

  return (
    <Tooltip content={label} positioning={{ placement: "bottom" }} showArrow openDelay={0}>
      <Card.Root
        role="button"
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        cursor="pointer"
        borderWidth="1px"
        borderColor={selected ? "border.inverted/30" : "border.inverted/10"}
        bg="bg.subtle/30"
        transition="all 0.2s ease"
        aspectRatio="1 / 1"
        display="flex"
        maxW="75px"
        minW="65px"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          filter={selected ? "grayscale(0%)" : "grayscale(100%)"}
          transition="filter 0.2s ease"
        >
          {icon ? (
            <Icon size={size ?? "md"}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={iconSrc} alt={iconAlt} />
            </Icon>
          ) : (
            <Text textStyle="sm" fontWeight="normal" color="CaptionText" textAlign="center">
              {label}
            </Text>
          )}
        </Box>
      </Card.Root>
    </Tooltip>
  );
}
