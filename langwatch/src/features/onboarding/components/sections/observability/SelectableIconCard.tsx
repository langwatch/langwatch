import React from "react";
import { Box, Card, Icon, Text, type IconProps } from "@chakra-ui/react";
import { Tooltip } from "../../../../../components/ui/tooltip";

interface SelectableIconCardProps {
  label: string;
  icon?: React.ReactNode;
  size?: IconProps["size"];
  selected: boolean;
  onClick: () => void;
  ariaLabel: string;
}

export function SelectableIconCard(props: SelectableIconCardProps): React.ReactElement {
  const { label, icon, size, selected, onClick, ariaLabel } = props;
  return (
    <Tooltip content={label} positioning={{ placement: "bottom" }} showArrow openDelay={0}>
      <Card.Root
        role="button"
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        cursor="pointer"
        borderWidth="1px"
        borderColor={selected ? "border.inverted/20" : "border.inverted/05"}
        bg="bg.subtle/30"
        transition="all 0.2s ease"
        aspectRatio="1 / 1"
        display="flex"
        alignItems="center"
        justifyContent="center"
        _hover={{ filter: "grayscale(0%)" }}
      >
        <Box filter={selected ? "grayscale(0%)" : "grayscale(100%)"} transition="filter 0.2s ease">
          {icon ? (
            <Icon size={size ?? "md"}>{icon}</Icon>
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
