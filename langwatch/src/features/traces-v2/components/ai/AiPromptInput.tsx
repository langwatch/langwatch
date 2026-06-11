import {
  Box,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Text,
} from "@chakra-ui/react";
import { AlertCircle, X } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import {
  GradientSparkle,
  SparkleGradientDefs,
  thinkingShimmerStyles,
} from "./aiBrandVisuals";
import { DEFAULT_THINKING_VERBS, useCyclingVerb } from "./useCyclingVerb";
import { useTypewriterPlaceholder } from "./useTypewriterPlaceholder";

const ICON_GRADIENT_ID = "ai-icon-gradient";

export interface AiPromptInputProps {
  /** The current text in the input — controlled. */
  prompt: string;
  /** Called whenever the user types. */
  onPromptChange: (next: string) => void;
  /** Fired on Enter (only when prompt is non-empty and not pending). */
  onSubmit: () => void;
  /** Fired on Esc, or when the user clicks the X button. */
  onClose: () => void;
  /** Whether a request is in flight — disables editing, shows shimmer text. */
  isPending: boolean;
  /** Optional error message to surface in a small badge. */
  error?: string | null;
  /** Cycling placeholder examples. Defaults are filter-flavoured. */
  placeholderExamples?: readonly string[];
  /** Cycling verbs while pending ("Thinking about", "Researching", …). */
  thinkingVerbs?: readonly string[];
}

const DEFAULT_PLACEHOLDER_EXAMPLES = [
  "Describe what you're looking for…",
  "Try: errors in the last hour",
  "Maybe: slow GPT-4 calls today",
  "How about: traces with negative feedback",
];

/**
 * Stateless AI prompt input — handles the typewriter placeholder, the
 * shimmering "thinking" state, the error badge, and the submit/escape
 * keystrokes. The actual request dispatch is the caller's job (so the
 * same UI can drive different actions: applying a filter, creating a
 * lens, generating a chart, etc.).
 *
 * Lives in `traces-v2/components/ai` so any traces-v2 surface can drop
 * it in. Pair with a thin dispatcher hook (e.g. `useAiTraceAction`) for
 * the most common flow.
 */
export const AiPromptInput: React.FC<AiPromptInputProps> = ({
  prompt,
  onPromptChange,
  onSubmit,
  onClose,
  isPending,
  error,
  placeholderExamples = DEFAULT_PLACEHOLDER_EXAMPLES,
  thinkingVerbs = DEFAULT_THINKING_VERBS,
}) => {
  const reduceMotion = useReducedMotion();
  const typewriter = useTypewriterPlaceholder(
    !prompt && !isPending,
    placeholderExamples,
  );
  const verb = useCyclingVerb(isPending, thinkingVerbs);
  // The shimmer's `animation` property comes from `thinkingShimmerStyles`;
  // override it to `none` for users who prefer reduced motion. Static
  // gradient stays so the text still reads as the AI brand colour
  // sweep, just without the infinite sweep.
  const shimmerCss = reduceMotion
    ? { ...thinkingShimmerStyles, animation: "none" }
    : thinkingShimmerStyles;

  // Pending mode swaps the Input for a shimmer Box that has no key
  // handlers — without a global listener the user couldn't cancel an
  // in-flight AI request with Esc. The mutation itself can't be aborted
  // mid-flight (tRPC mutate has no native cancel), but `onClose` tears
  // down the composer, which flips the host hook's `cancelledRef` so
  // any late response is dropped on the floor and the user gets out.
  useEffect(() => {
    if (!isPending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isPending, onClose]);

  return (
    <Flex align="center" gap={2} width="full" position="relative">
      <SparkleGradientDefs id={ICON_GRADIENT_ID} />
      <Box flexShrink={0}>
        <GradientSparkle size={14} gradientId={ICON_GRADIENT_ID} />
      </Box>
      {isPending ? (
        <Box
          flex={1}
          minWidth={0}
          fontSize="xs"
          fontWeight="500"
          letterSpacing="-0.005em"
          truncate
          css={shimmerCss}
        >
          {`${verb} ${prompt}…`}
        </Box>
      ) : (
        <Input
          autoFocus
          placeholder={typewriter}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          variant="flushed"
          size="xs"
          paddingX={0}
          fontSize="xs"
          fontWeight="500"
          letterSpacing="-0.005em"
          border="none"
          bg="transparent"
          _placeholder={{ color: "fg.muted" }}
          _focus={{ outline: "none", boxShadow: "none" }}
          flex={1}
          minWidth={0}
        />
      )}
      {error && (
        <Tooltip content={error} openDelay={100}>
          <HStack
            gap={1}
            paddingX={2}
            paddingY={0.5}
            borderRadius="sm"
            bg="red.subtle"
            color="red.fg"
            flexShrink={0}
            maxWidth="40%"
            minWidth={0}
            cursor="help"
          >
            <Icon boxSize="12px" flexShrink={0}>
              <AlertCircle />
            </Icon>
            <Text textStyle="2xs" fontWeight="600" truncate>
              {error}
            </Text>
          </HStack>
        </Tooltip>
      )}
      <Tooltip
        content={isPending ? "Cancel (Esc)" : "Exit AI mode (Esc)"}
        openDelay={200}
      >
        <IconButton
          aria-label={isPending ? "Cancel AI request" : "Exit AI mode"}
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={onClose}
        >
          <X size={13} />
        </IconButton>
      </Tooltip>
    </Flex>
  );
};
