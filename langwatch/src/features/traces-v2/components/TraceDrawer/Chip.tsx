import { Box, Circle, HStack, Icon, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import type { IconType } from "react-icons";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";

export type ChipTone =
  | "neutral"
  | "purple"
  | "blue"
  | "green"
  | "yellow"
  | "red";

interface ToneStyle {
  bg: string;
  border: string;
  fg: string;
  hoverBg: string;
}

const TONE_STYLES: Record<ChipTone, ToneStyle> = {
  neutral: {
    bg: "bg.subtle",
    border: "border.muted",
    fg: "fg.muted",
    hoverBg: "bg.muted",
  },
  purple: {
    bg: "purple.500/8",
    border: "purple.500/30",
    fg: "purple.fg",
    hoverBg: "purple.500/14",
  },
  blue: {
    bg: "blue.500/8",
    border: "blue.500/30",
    fg: "blue.fg",
    hoverBg: "blue.500/14",
  },
  green: {
    bg: "green.500/8",
    border: "green.500/30",
    fg: "green.fg",
    hoverBg: "green.500/14",
  },
  yellow: {
    bg: "yellow.500/8",
    border: "yellow.500/30",
    fg: "yellow.fg",
    hoverBg: "yellow.500/14",
  },
  red: {
    bg: "red.500/8",
    border: "red.500/30",
    fg: "red.fg",
    hoverBg: "red.500/14",
  },
};

export interface ChipProps {
  /** Small uppercase label/prefix shown before the value. */
  label?: string;
  /** Primary value — string or rich node. */
  value: ReactNode;
  /** Status dot colour token. */
  dot?: string;
  /** Optional leading icon. */
  icon?: IconType;
  /** Visual tone. */
  tone?: ChipTone;
  /** Click handler — chip becomes a button when set. */
  onClick?: () => void;
  /** Hover tooltip body. Ignored when `popover` is also set. */
  tooltip?: ReactNode;
  /** Click-to-open popover body. Wraps the chip in a Popover.Root. */
  popover?: ReactNode;
  /** Max width of the value text — falls back to a sensible default. */
  maxValueWidth?: string;
  /** Accessible label override. */
  ariaLabel?: string;
}

const DEFAULT_VALUE_MAX_WIDTH = "180px";

/**
 * Pill-shaped chip used in the trace drawer header. Renders consistently
 * regardless of whether it's interactive (popover/onClick) or static. Pair
 * with `ChipBar` for the standard horizontal strip.
 */
export const Chip = forwardRef<HTMLDivElement, ChipProps>(function Chip(
  {
    label,
    value,
    dot,
    icon,
    tone = "neutral",
    onClick,
    tooltip,
    popover,
    maxValueWidth = DEFAULT_VALUE_MAX_WIDTH,
    ariaLabel,
  },
  ref,
) {
  const style = TONE_STYLES[tone];
  const isInteractive = !!onClick || !!popover;

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
    >
      {dot && <Circle size="6px" bg={dot} flexShrink={0} />}
      {icon && <Icon as={icon} boxSize={3} color={style.fg} flexShrink={0} />}
      {label && (
        <Text
          textStyle="2xs"
          color={style.fg}
          fontFamily="mono"
          textTransform="uppercase"
          letterSpacing="0.04em"
          fontWeight="medium"
          flexShrink={0}
        >
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
    </HStack>
  );

  if (popover) {
    return (
      <Popover.Root positioning={{ placement: "bottom-start" }} lazyMount>
        <Popover.Trigger asChild>{body}</Popover.Trigger>
        <Popover.Content width="360px">
          <Popover.Body padding={0}>{popover}</Popover.Body>
        </Popover.Content>
      </Popover.Root>
    );
  }

  if (tooltip) {
    return (
      <Tooltip content={tooltip} positioning={{ placement: "top" }}>
        <Box display="inline-flex">{body}</Box>
      </Tooltip>
    );
  }

  return body;
});
