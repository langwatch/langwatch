import { Box, Circle, HStack, Icon, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import type { IconType } from "react-icons";
import { LuFilter } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";

export type SimulationChipTone = "neutral" | "purple" | "blue" | "green" | "yellow" | "red";

const TONE_STYLES: Record<
  SimulationChipTone,
  { bg: string; border: string; fg: string; hoverBg: string }
> = {
  neutral: { bg: "bg.subtle", border: "border", fg: "fg.muted", hoverBg: "bg.muted" },
  purple: {
    bg: "purple.solid/8",
    border: "purple.solid/30",
    fg: "purple.fg",
    hoverBg: "purple.solid/14",
  },
  blue: {
    bg: "blue.solid/8",
    border: "blue.solid/30",
    fg: "blue.fg",
    hoverBg: "blue.solid/14",
  },
  green: {
    bg: "green.solid/8",
    border: "green.solid/30",
    fg: "green.fg",
    hoverBg: "green.solid/14",
  },
  yellow: {
    bg: "yellow.solid/8",
    border: "yellow.solid/30",
    fg: "yellow.fg",
    hoverBg: "yellow.solid/14",
  },
  red: {
    bg: "red.solid/8",
    border: "red.solid/30",
    fg: "red.fg",
    hoverBg: "red.solid/14",
  },
};

export interface SimulationChipProps {
  label?: string;
  value: ReactNode;
  dot?: string;
  icon?: IconType;
  tone?: SimulationChipTone;
  onClick?: () => void;
  tooltip?: ReactNode;
  maxValueWidth?: string;
  ariaLabel?: string;
  onFilter?: () => void;
  filterLabel?: string;
}

export const SimulationChip = forwardRef<HTMLDivElement, SimulationChipProps>(
  function SimulationChip(
    {
      label,
      value,
      dot,
      icon,
      tone = "neutral",
      onClick,
      tooltip,
      maxValueWidth = "180px",
      ariaLabel,
      onFilter,
      filterLabel = "Add to filter on the trace table",
    },
    ref,
  ) {
    const style = TONE_STYLES[tone];
    const isInteractive = !!onClick;
    const body = (
      <HStack
        ref={ref}
        as={isInteractive ? "button" : "div"}
        onClick={onClick}
        gap={1.5}
        paddingX={2}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor={style.border}
        bg={style.bg}
        cursor={isInteractive ? "pointer" : "default"}
        transition="background 0.12s ease, filter 0.12s ease"
        _hover={isInteractive ? { bg: style.hoverBg } : undefined}
        aria-label={ariaLabel}
        minWidth={0}
        className="chip-root"
      >
        {dot && <Circle size="8px" bg={dot} flexShrink={0} />}
        {icon && <Icon as={icon} boxSize={3} color={style.fg} flexShrink={0} />}
        {label && (
          <Text textStyle="2xs" color={style.fg} fontWeight="medium" flexShrink={0}>
            {label}
          </Text>
        )}
        <Box
          maxWidth={maxValueWidth}
          minWidth={0}
          overflow="hidden"
          whiteSpace="nowrap"
          textOverflow="ellipsis"
        >
          {typeof value === "string" ? (
            <Text
              textStyle="xs"
              color={tone === "neutral" ? "fg" : style.fg}
              fontWeight="medium"
              truncate
            >
              {value}
            </Text>
          ) : (
            value
          )}
        </Box>
        {onFilter && (
          <Tooltip content={filterLabel} positioning={{ placement: "top" }}>
            <Box
              as="button"
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                onFilter();
              }}
              aria-label={filterLabel}
              display="inline-flex"
              alignItems="center"
              justifyContent="center"
              paddingX={0.5}
              marginLeft={0.5}
              borderRadius="sm"
              cursor="pointer"
              opacity={0.55}
              _hover={{ opacity: 1, bg: "bg.muted" }}
            >
              <Icon as={LuFilter} boxSize={3} color={style.fg} />
            </Box>
          </Tooltip>
        )}
      </HStack>
    );
    if (tooltip)
      return (
        <Tooltip content={tooltip} positioning={{ placement: "top" }}>
          <Box display="inline-flex">{body}</Box>
        </Tooltip>
      );
    return body;
  },
);
