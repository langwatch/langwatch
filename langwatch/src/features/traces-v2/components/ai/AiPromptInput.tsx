import { Box, Flex, IconButton, Input, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { Sparkles, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { AiActionError } from "~/server/app-layer/traces/ai-query";
import { aiBrandPalette } from "./aiBrandPalette";
import { DEFAULT_THINKING_VERBS, useCyclingVerb } from "./useCyclingVerb";

const ICON_GRADIENT_ID = "ai-icon-gradient";

// Use the emotion `keyframes` helper so the @keyframes rule is actually
// emitted into the document head — embedding `"@keyframes …"` inside a
// css object silently fails (CSS @rules can't nest inside selectors), so
// the shimmer was previously running on a non-existent animation name.
const aiThinkingShimmer = keyframes`
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;

// Sweep the three AI brand stops (orange → pink → violet) through the
// muted body colour so the shimmer reads as the same "AI" gradient the
// Sparkles icon and Ask AI button use, instead of a single flat accent.
const thinkingShimmerStyles = {
  background: `linear-gradient(
    90deg,
    var(--chakra-colors-fg-muted) 0%,
    var(--chakra-colors-fg-muted) 25%,
    ${aiBrandPalette[0]} 42%,
    ${aiBrandPalette[1]} 50%,
    ${aiBrandPalette[2]} 58%,
    var(--chakra-colors-fg-muted) 75%,
    var(--chakra-colors-fg-muted) 100%
  )`,
  backgroundSize: "250% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: `${aiThinkingShimmer} 4.5s linear infinite`,
};

const TYPING_MS = 70;
const ERASING_MS = 40;
const HOLD_MS = 2600;

const useTypewriterPlaceholder = (
  active: boolean,
  examples: readonly string[],
): string => {
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState(examples[0] ?? "");

  useEffect(() => {
    if (!active || reduceMotion) {
      setText(examples[0] ?? "");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let index = 0;
    let charIndex = (examples[0] ?? "").length;
    let phase: "type" | "hold" | "erase" = "hold";

    const tick = () => {
      if (cancelled) return;
      const word = examples[index] ?? "";

      if (phase === "type") {
        charIndex++;
        setText(word.slice(0, charIndex));
        if (charIndex >= word.length) {
          phase = "hold";
          timer = setTimeout(tick, HOLD_MS);
        } else {
          timer = setTimeout(tick, TYPING_MS);
        }
        return;
      }

      if (phase === "hold") {
        phase = "erase";
        timer = setTimeout(tick, ERASING_MS);
        return;
      }

      charIndex--;
      setText(word.slice(0, Math.max(charIndex, 0)));
      if (charIndex <= 0) {
        index = (index + 1) % examples.length;
        charIndex = 0;
        phase = "type";
      }
      timer = setTimeout(tick, ERASING_MS);
    };

    timer = setTimeout(tick, HOLD_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, reduceMotion, examples]);

  return text;
};

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
  /** Optional structured error to surface in a small badge. */
  error?: AiActionError | null;
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
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: "absolute" }}
      >
        <defs>
          <linearGradient
            id={ICON_GRADIENT_ID}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            {aiBrandPalette.map((color, i) => (
              <stop
                key={color}
                offset={`${(i / (aiBrandPalette.length - 1)) * 100}%`}
                stopColor={color}
              />
            ))}
          </linearGradient>
        </defs>
      </svg>
      <Box flexShrink={0}>
        <Sparkles size={14} stroke={`url(#${ICON_GRADIENT_ID})`} />
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

