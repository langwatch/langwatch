import { chakra, HStack, Text } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type MouseEvent } from "react";
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The sheet's empty-state invitation: "Your project is quiet." followed by a
 * first step that TYPES AND DELETES itself in rotation — send a trace,
 * generate a dataset, run an experiment, create a simulation — so the blank
 * page demonstrates motion instead of apologising for stillness.
 *
 * Each suggestion has exactly two ways in, mirroring the attention-inbox rows:
 * open the surface behind it (learn more), or hand it to Langy — one click to
 * a conversation that is already answering how to do it. Reduced motion pins
 * the first phrase, fully typed, no caret blink.
 */

const SERIF =
  'var(--langy-font-serif, "Sentient", "Charter", "Source Serif Pro", Georgia, serif)';

interface QuietAction {
  /** The typed phrase, as an imperative first step. */
  phrase: string;
  /** Where "learn more" lands — the feature surface that teaches it. */
  href: (slug: string) => string;
  /** The question handed to Langy (auto-sent) when the reader asks instead. */
  ask: string;
}

const ACTIONS: QuietAction[] = [
  {
    phrase: "Send a trace",
    href: (slug) => `/${slug}/messages`,
    ask: "How do I send my first trace to LangWatch? Walk me through the quickest integration for my stack.",
  },
  {
    phrase: "Generate a dataset",
    href: (slug) => `/${slug}/datasets`,
    ask: "Help me generate my first dataset — what can I build it from, and what makes a good one?",
  },
  {
    phrase: "Run an experiment",
    href: (slug) => `/${slug}/experiments`,
    ask: "How do I run my first experiment here — what should I evaluate first?",
  },
  {
    phrase: "Create a simulation",
    href: (slug) => `/${slug}/simulations`,
    ask: "Help me create my first agent simulation.",
  },
];

/** Typing cadence: brisk in, brisker out, a beat to read, a breath between. */
const TYPE_MS = 55;
const DELETE_MS = 28;
const HOLD_MS = 2400;
const GAP_MS = 400;

export function QuietHeadline() {
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const askLangy = useLangyStore((s) => s.askLangy);
  // The invitation renders wherever the signal-focused home does, which no
  // longer implies Langy (spec: specs/home/signal-focused-home-rollout.feature).
  // Without Langy, the typed phrase opens the feature surface instead of a
  // conversation, and the hand-to-Langy action disappears.
  const showLangy = useShowLangy();

  // One tiny state machine: grow to the full phrase, hold, shrink to zero,
  // step to the next phrase. Each transition schedules exactly one timeout,
  // so unmounting cancels cleanly mid-word.
  const [step, setStep] = useState({ index: 0, length: 0, deleting: false });

  useEffect(() => {
    if (reduceMotion) return;
    const phrase = ACTIONS[step.index % ACTIONS.length]!.phrase;
    let delay: number;
    let next: typeof step;
    if (!step.deleting) {
      if (step.length < phrase.length) {
        delay = TYPE_MS;
        next = { ...step, length: step.length + 1 };
      } else {
        delay = HOLD_MS;
        next = { ...step, deleting: true };
      }
    } else if (step.length > 0) {
      delay = DELETE_MS;
      next = { ...step, length: step.length - 1 };
    } else {
      delay = GAP_MS;
      next = {
        index: (step.index + 1) % ACTIONS.length,
        length: 0,
        deleting: false,
      };
    }
    const timeout = setTimeout(() => setStep(next), delay);
    return () => clearTimeout(timeout);
  }, [step, reduceMotion]);

  const action = ACTIONS[step.index % ACTIONS.length]!;
  const typed = reduceMotion
    ? action.phrase
    : action.phrase.slice(0, step.length);

  const onLearnMore = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!project) return;
    event.preventDefault();
    void router.push(action.href(project.slug));
  };

  // The typed phrase's click: hand the suggestion to Langy when the user has
  // it, otherwise open the surface that teaches the step — the phrase is
  // never a dead control.
  const onPhrase = () => {
    if (showLangy) {
      askLangy(action.ask);
    } else if (project) {
      void router.push(action.href(project.slug));
    }
  };

  return (
    <chakra.div>
      <Text
        fontFamily={SERIF}
        fontWeight="400"
        fontSize={{ base: "16px", md: "18px" }}
        lineHeight="1.3"
        letterSpacing="-0.01em"
        color="fg"
        maxWidth="60ch"
      >
        Your project is quiet.{" "}
        {/* The typed phrase IS a control: clicking it hands the current
            suggestion to Langy, question already sent. */}
        <chakra.button
          type="button"
          onClick={onPhrase}
          aria-label={
            showLangy
              ? `Ask Langy: ${action.phrase}`
              : `Learn more: ${action.phrase}`
          }
          fontFamily="inherit"
          fontSize="inherit"
          letterSpacing="inherit"
          lineHeight="inherit"
          color="orange.fg"
          cursor="pointer"
          textAlign="left"
          borderBottomWidth="1px"
          borderBottomStyle="dashed"
          borderColor="orange.emphasized"
          transition="border-color 130ms ease"
          _hover={{ borderColor: "orange.fg" }}
        >
          {typed}
        </chakra.button>
        {reduceMotion ? null : (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            style={{ display: "inline-block", marginLeft: "1px" }}
          >
            ▍
          </motion.span>
        )}
      </Text>

      {/* The two ways in, pinned below the line so they never jump while the
          phrase types. Both follow the CURRENT suggestion. */}
      <HStack gap={4} marginTop={2}>
        <chakra.a
          href={project ? action.href(project.slug) : undefined}
          onClick={onLearnMore}
          fontFamily="mono"
          fontSize="12px"
          color="fg.muted"
          cursor="pointer"
          whiteSpace="nowrap"
          borderBottomWidth="1px"
          borderColor="transparent"
          transition="color 130ms ease, border-color 130ms ease"
          _hover={{ color: "fg", borderColor: "fg.muted" }}
        >
          Learn more →
        </chakra.a>
        {showLangy ? (
          <chakra.button
            type="button"
            onClick={() => askLangy(action.ask)}
            display="inline-flex"
            alignItems="center"
            gap={1}
            fontFamily="mono"
            fontSize="12px"
            color="orange.fg"
            cursor="pointer"
            whiteSpace="nowrap"
            borderBottomWidth="1px"
            borderColor="transparent"
            transition="border-color 130ms ease"
            _hover={{ borderColor: "orange.fg" }}
          >
            <Sparkles size={12} />
            Do it with Langy
          </chakra.button>
        ) : null}
      </HStack>
    </chakra.div>
  );
}
