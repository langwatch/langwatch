import {
  Box,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Text,
} from "@chakra-ui/react";
import { AlertCircle, Sparkles, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { aiBrandPalette } from "./aiBrandPalette";

const ICON_GRADIENT_ID = "ai-icon-gradient";

const thinkingShimmerStyles = {
  background: `linear-gradient(90deg, var(--chakra-colors-fg-muted) 0%, var(--chakra-colors-fg-muted) 35%, ${aiBrandPalette[2]} 50%, var(--chakra-colors-fg-muted) 65%, var(--chakra-colors-fg-muted) 100%)`,
  backgroundSize: "250% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: "ai-thinking-shimmer 2.4s linear infinite",
  "@keyframes ai-thinking-shimmer": {
    "0%": { backgroundPosition: "200% 0" },
    "100%": { backgroundPosition: "-200% 0" },
  },
};

const DEFAULT_THINKING_VERBS = [
  "Thinking about",
  "Pondering",
  "Researching",
  "Looking into",
  "Procrastinating about",
  "Mulling over",
  "Untangling",
  "Diving into",
];

const useCyclingVerb = (active: boolean, verbs: readonly string[]): string => {
  const reduceMotion = useReducedMotion();
  const [verb, setVerb] = useState(verbs[0] ?? "");
  useEffect(() => {
    if (!active || reduceMotion) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % verbs.length;
      setVerb(verbs[i] ?? "");
    }, 1800);
    return () => clearInterval(id);
  }, [active, reduceMotion, verbs]);
  return verb;
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
  const typewriter = useTypewriterPlaceholder(
    !prompt && !isPending,
    placeholderExamples,
  );
  const verb = useCyclingVerb(isPending, thinkingVerbs);

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
          css={thinkingShimmerStyles}
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
      <Tooltip content="Exit AI mode (Esc)" openDelay={200}>
        <IconButton
          aria-label="Exit AI mode"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={onClose}
          disabled={isPending}
        >
          <X size={13} />
        </IconButton>
      </Tooltip>
    </Flex>
  );
};
