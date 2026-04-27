import { Box, Circle, Flex, Icon, Text } from "@chakra-ui/react";
import type React from "react";

export type BubbleSide = "left" | "right";
export type BubbleTone = "user" | "assistant" | "error" | "system";
export type BubbleSize = "compact" | "regular";

export interface BubblePalette {
  bg: string;
  fg: string;
  /** Solid color used for the avatar circle and the speaker label. */
  accent: string;
  selectedBg: string;
}

export const BUBBLE_TONES: Record<BubbleTone, BubblePalette> = {
  user: {
    bg: "blue.subtle",
    fg: "fg",
    accent: "blue.solid",
    selectedBg: "blue.muted",
  },
  assistant: {
    bg: "purple.subtle",
    fg: "fg",
    accent: "purple.solid",
    selectedBg: "purple.muted",
  },
  error: {
    bg: "red.subtle",
    fg: "red.fg",
    accent: "red.solid",
    selectedBg: "red.muted",
  },
  system: {
    bg: "bg.subtle",
    fg: "fg.muted",
    accent: "fg.muted",
    selectedBg: "bg.muted",
  },
};

interface BubbleProps {
  side: BubbleSide;
  tone: BubbleTone;
  /** Display name shown next to the avatar (e.g. "User", "gpt-4o"). */
  label: string;
  icon: React.ReactNode;
  text: string;
  isSelected?: boolean;
  onClick?: () => void;
  /**
   * `compact` uses tighter padding and larger max-width — use it for the
   * conversation tab inside the trace drawer where vertical real estate
   * is scarce. `regular` is broader, used in the comfortable conversations
   * table.
   */
  size?: BubbleSize;
  /** Truncate the text body to N characters. Set to 0 to disable. */
  maxChars?: number;
}

export const Bubble: React.FC<BubbleProps> = ({
  side,
  tone,
  label,
  icon,
  text,
  isSelected = false,
  onClick,
  size = "regular",
  maxChars = 320,
}) => {
  const palette = BUBBLE_TONES[tone];
  const compact = size === "compact";
  const display =
    maxChars > 0 && text.length > maxChars
      ? `${text.slice(0, maxChars)}…`
      : text;

  return (
    <Flex
      align="flex-end"
      gap={2}
      flexDirection={side === "right" ? "row-reverse" : "row"}
      width="full"
    >
      <Circle
        size={compact ? "22px" : "26px"}
        bg={palette.accent}
        color="white"
        flexShrink={0}
        marginBottom="2px"
      >
        <Icon boxSize={compact ? "12px" : "14px"}>{icon}</Icon>
      </Circle>

      <Box
        maxWidth={compact ? "calc(100% - 36px)" : "calc(85% - 36px)"}
        bg={isSelected ? palette.selectedBg : palette.bg}
        color={palette.fg}
        paddingX={compact ? 3.5 : 4}
        paddingY={compact ? 2.5 : 3}
        borderRadius="2xl"
        borderTopLeftRadius={side === "left" ? "sm" : "2xl"}
        borderTopRightRadius={side === "right" ? "sm" : "2xl"}
        cursor={onClick ? "pointer" : "default"}
        transition="background 0.15s ease, transform 0.15s ease"
        _hover={
          onClick
            ? { bg: palette.selectedBg, transform: "translateY(-1px)" }
            : undefined
        }
        onClick={(e: React.MouseEvent) => {
          if (!onClick) return;
          e.stopPropagation();
          onClick();
        }}
      >
        <Text
          textStyle="2xs"
          fontWeight="600"
          color={palette.accent}
          marginBottom={1}
          letterSpacing="0.02em"
        >
          {label}
        </Text>
        <Text
          textStyle={compact ? "xs" : "sm"}
          whiteSpace="pre-wrap"
          lineHeight="1.55"
          lineClamp={compact ? 8 : 6}
        >
          {display}
        </Text>
      </Box>
    </Flex>
  );
};
