import { Box, IconButton, Text, VStack } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TooltipLine } from "./types";

interface CollapsedFacetIconProps {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  badgeCount?: number;
  tooltipLines: TooltipLine[];
  onClick: () => void;
}

export const CollapsedFacetIcon: React.FC<CollapsedFacetIconProps> = ({
  icon: Icon,
  label,
  isActive,
  badgeCount,
  tooltipLines,
  onClick,
}) => (
  <Tooltip
    content={
      isActive ? (
        <ActiveTooltip label={label} lines={tooltipLines} />
      ) : (
        label
      )
    }
    positioning={{ placement: "right" }}
  >
    <IconButton
      aria-label={ariaLabelFor({ label, isActive, badgeCount })}
      size="xs"
      variant="ghost"
      color={isActive ? "blue.fg" : "fg.subtle"}
      onClick={onClick}
      position="relative"
    >
      <Icon size={14} />
      {isActive && badgeCount !== undefined && badgeCount > 0 && (
        <CountBadge count={badgeCount} />
      )}
      {isActive && badgeCount === undefined && <ActiveDot />}
    </IconButton>
  </Tooltip>
);

const ActiveTooltip: React.FC<{ label: string; lines: TooltipLine[] }> = ({
  label,
  lines,
}) => (
  <VStack gap={0.5} align="start">
    <Text textStyle="xs" fontWeight="semibold">
      {label}
    </Text>
    {lines.map((line, i) => (
      <Text
        key={`${i}-${line.text}`}
        textStyle="2xs"
        color={line.negated ? "red.fg" : undefined}
      >
        {line.text}
      </Text>
    ))}
  </VStack>
);

const CountBadge: React.FC<{ count: number }> = ({ count }) => (
  <Box
    position="absolute"
    top="-2px"
    right="-2px"
    minWidth="14px"
    height="14px"
    paddingX="3px"
    borderRadius="full"
    bg="blue.solid"
    color="white"
    textStyle="2xs"
    fontWeight="600"
    lineHeight="14px"
    textAlign="center"
  >
    {count}
  </Box>
);

const ActiveDot: React.FC = () => (
  <Box
    position="absolute"
    top="0"
    right="0"
    width="6px"
    height="6px"
    borderRadius="full"
    bg="blue.solid"
  />
);

function ariaLabelFor({
  label,
  isActive,
  badgeCount,
}: {
  label: string;
  isActive: boolean;
  badgeCount?: number;
}): string {
  if (!isActive) return label;
  if (badgeCount === undefined) return `${label} — active`;
  return `${label} — ${badgeCount} active filter${badgeCount === 1 ? "" : "s"}`;
}
