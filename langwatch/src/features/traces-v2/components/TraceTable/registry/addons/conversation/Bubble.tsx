import { Box, Circle, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { Lightbulb, MessageSquare } from "lucide-react";
import type React from "react";
import { Markdown } from "~/components/Markdown";
import { ReasoningBlock } from "../../../../TraceDrawer/transcript";

export type BubbleSide = "left" | "right";
export type BubbleTone = "user" | "assistant" | "error" | "system";
export type BubbleSize = "compact" | "regular";

export interface BubblePalette {
  bg: string;
  fg: string;
  accent: string;
  avatarBg: string;
  avatarFg: string;
  selectedBg: string;
}

export const BUBBLE_TONES: Record<BubbleTone, BubblePalette> = {
  user: {
    bg: "blue.subtle",
    fg: "fg",
    accent: "blue.fg",
    avatarBg: "blue.muted",
    avatarFg: "blue.fg",
    selectedBg: "blue.subtle",
  },
  assistant: {
    bg: "bg.muted",
    fg: "fg",
    accent: "purple.fg",
    avatarBg: "purple.subtle",
    avatarFg: "purple.fg",
    selectedBg: "bg.muted",
  },
  error: {
    bg: "red.subtle",
    fg: "red.fg",
    accent: "red.fg",
    avatarBg: "red.muted",
    avatarFg: "red.fg",
    selectedBg: "red.subtle",
  },
  system: {
    bg: "bg.panel",
    fg: "fg.muted",
    accent: "fg.muted",
    avatarBg: "bg.muted",
    avatarFg: "fg.muted",
    selectedBg: "bg.panel",
  },
};

interface BubbleProps {
  side: BubbleSide;
  tone: BubbleTone;
  label: string;
  icon: React.ReactNode;
  text: string;
  reasoning?: string;
  isSelected?: boolean;
  onClick?: () => void;
  size?: BubbleSize;
  /** Truncate the text body to N characters. 0 disables. */
  maxChars?: number;
  /**
   * When set, marks the bubble as carrying annotations. The amber accent
   * stripe lights up so a long thread is scannable for noted turns;
   * `hasCorrection` upgrades the inline badge to the lightbulb tone used
   * elsewhere for "suggested output".
   */
  annotation?: { count: number; hasCorrection: boolean };
}

const DEFAULT_MAX_CHARS = 320;
const TRUNCATE_BREAK_PREFER_RATIO = 0.5;

// Cuts on a paragraph/sentence boundary above maxChars*ratio so we don't slice
// mid-token and produce broken markdown (unclosed code fences, dangling lists).
function truncateMarkdown({
  text,
  maxChars,
}: {
  text: string;
  maxChars: number;
}): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastBreak = Math.max(
    truncated.lastIndexOf("\n\n"),
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf(". "),
  );
  const cut =
    lastBreak > maxChars * TRUNCATE_BREAK_PREFER_RATIO ? lastBreak : maxChars;
  return `${text.slice(0, cut).trimEnd()}\n\n…`;
}

export const Bubble: React.FC<BubbleProps> = ({
  side,
  tone,
  label,
  icon,
  text,
  reasoning,
  isSelected = false,
  onClick,
  size = "regular",
  maxChars = DEFAULT_MAX_CHARS,
  annotation,
}) => {
  const palette = BUBBLE_TONES[tone];
  const compact = size === "compact";
  const display = truncateMarkdown({ text, maxChars });
  const hasAnnotation = !!annotation && annotation.count > 0;

  return (
    <Flex
      align="center"
      gap={2}
      flexDirection={side === "right" ? "row-reverse" : "row"}
      width="full"
    >
      <Circle
        size={compact ? "22px" : "26px"}
        bg={palette.avatarBg}
        color={palette.avatarFg}
        flexShrink={0}
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
        position="relative"
        boxShadow={
          hasAnnotation
            ? `inset ${side === "right" ? "-3px" : "3px"} 0 0 var(--chakra-colors-amber-solid)`
            : undefined
        }
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
        <HStack gap={1.5} marginBottom={1} align="center">
          <Text
            textStyle="2xs"
            fontWeight="600"
            color={palette.accent}
            letterSpacing="0.02em"
          >
            {label}
          </Text>
          {hasAnnotation && (
            <HStack
              gap={0.5}
              paddingX={1.5}
              paddingY={0.5}
              borderRadius="sm"
              bg="amber.subtle"
              color="amber.fg"
              aria-label={`${annotation!.count} annotation${
                annotation!.count === 1 ? "" : "s"
              }${annotation!.hasCorrection ? ", includes correction" : ""}`}
            >
              <Icon as={MessageSquare} boxSize="10px" />
              <Text textStyle="2xs" fontWeight="600" lineHeight="1">
                {annotation!.count}
              </Text>
              {annotation!.hasCorrection && (
                <Icon as={Lightbulb} boxSize="10px" color="yellow.fg" />
              )}
            </HStack>
          )}
        </HStack>
        {reasoning && (
          <Box
            mb={text ? "3" : "0"}
            borderBottomWidth={text ? "1px" : "0"}
            borderBottomColor="border.subtle"
            bg="bg.muted/60"
            px="3"
            py="2"
            borderRadius="md"
            mx="-1"
          >
            <ReasoningBlock text={reasoning} />
          </Box>
        )}
        <Box
          css={{
            // Markdown renders inside <Prose>, which scales h1..h3 (2em/1.5em/
            // 1.2em). In a chat bubble those headings dominate; tame them so
            // chat content reads as conversation.
            "& > div": {
              fontSize: compact ? "13.5px" : "14px",
              lineHeight: "1.55",
            },
            "& h1": { fontSize: "1.15em !important" },
            "& h2": { fontSize: "1.1em !important" },
            "& h3": { fontSize: "1.05em !important" },
            "& h4, & h5, & h6": { fontSize: "1em !important" },
          }}
        >
          <Markdown>{display}</Markdown>
        </Box>
      </Box>
    </Flex>
  );
};
