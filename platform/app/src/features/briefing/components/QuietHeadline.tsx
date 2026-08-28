import { chakra, HStack, Text } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { type MouseEvent, useEffect, useState } from "react";
import { LuArrowRight, LuZap } from "react-icons/lu";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useLangyStore } from "@langwatch/langy-web";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The sheet's empty-state invitation. Sending a trace is THE first step: until
 * data flows in, nothing else has anything to watch, so it leads as a prominent
 * primary button (the "send your first trace" call every new project needs),
 * with a one-click "walk me through it" hand-off to Langy beside it.
 *
 * Below the primary, the OTHER first steps rotate as a phrase that TYPES AND
 * DELETES itself (generate a dataset, run an experiment, create a simulation)
 * so the blank page demonstrates motion instead of apologising for stillness.
 * Each rotating step keeps its two ways in: open the surface behind it (learn
 * more), or hand it to Langy. Reduced motion pins the first phrase, fully
 * typed, no caret blink.
 */

const SERIF =
  'var(--langy-font-serif, "Sentient", "Charter", "Source Serif Pro", Georgia, serif)';

/** Where the primary "send your first trace" lands: the same trace surface the
 *  onboarding checklist points at, which teaches the integration when empty. */
const traceHref = (slug: string) => `/${slug}/traces`;
const TRACE_ASK =
  "How do I send my first trace to LangWatch? Walk me through the quickest integration for my stack.";

interface QuietAction {
  /** The typed phrase, as an imperative first step. */
  phrase: string;
  /** Where "learn more" lands: the feature surface that teaches it. */
  href: (slug: string) => string;
  /** The question handed to Langy (auto-sent) when the reader asks instead. */
  ask: string;
}

// Sending a trace is the primary button above, so the rotation offers the
// OTHER first steps a quiet project can start with.
const ACTIONS: QuietAction[] = [
  {
    phrase: "Generate a dataset",
    href: (slug) => `/${slug}/datasets`,
    ask: "Help me generate my first dataset, what can I build it from, and what makes a good one?",
  },
  {
    phrase: "Run an experiment",
    href: (slug) => `/${slug}/experiments`,
    ask: "How do I run my first experiment here, what should I evaluate first?",
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
  // conversation, and the hand-to-Langy actions disappear.
  // The hand-off AUTO-SENDS, so it needs the grant that starts a turn, not the
  // one that opens the panel. See `useCanAskLangy`.
  const canAsk = useCanAskLangy();

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
  const typed = reduceMotion ? action.phrase : action.phrase.slice(0, step.length);

  // Native anchor behavior (cmd/ctrl/shift-click, middle-click) belongs to
  // the browser: intercept ONLY an unmodified primary click, so open-in-a-tab
  // keeps working on these real links.
  const isPlainLeftClick = (event: MouseEvent<HTMLAnchorElement>) =>
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;

  // Primary: send your first trace, on the client router.
  const onSendTrace = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!project || !isPlainLeftClick(event)) return;
    event.preventDefault();
    void router.push(traceHref(project.slug));
  };

  const onLearnMore = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!project || !isPlainLeftClick(event)) return;
    event.preventDefault();
    void router.push(action.href(project.slug));
  };

  // The typed phrase's click: hand the suggestion to Langy when the user can,
  // otherwise open the surface that teaches the step, so the phrase is never a
  // dead control.
  const onPhrase = () => {
    if (canAsk) {
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
        Your project is quiet. Send a trace and the watch begins.
      </Text>

      {/* Primary: the one step that unblocks everything else. */}
      <HStack gap={2.5} marginTop={3} wrap="wrap" align="center">
        <chakra.a
          href={project ? traceHref(project.slug) : undefined}
          onClick={onSendTrace}
          aria-label="Send your first trace"
          display="inline-flex"
          alignItems="center"
          gap={1.5}
          fontFamily="mono"
          fontSize="12.5px"
          fontWeight="600"
          whiteSpace="nowrap"
          color="white"
          background="orange.solid"
          borderRadius="8px"
          paddingX={3.5}
          paddingY="7px"
          cursor="pointer"
          boxShadow="0 1px 2px rgba(0,0,0,0.12)"
          transition="opacity 130ms ease, transform 130ms ease"
          _hover={{ opacity: 0.92, transform: "translateY(-1px)" }}
          _active={{ transform: "translateY(0)" }}
        >
          <LuZap size={13} />
          Send your first trace
          <LuArrowRight size={13} />
        </chakra.a>
        {canAsk ? (
          <LangyHandOff
            label="Walk me through it"
            ariaLabel="Ask Langy how to send your first trace"
            onClick={() => askLangy(TRACE_ASK)}
          />
        ) : null}
      </HStack>

      {/* Secondary: the other first steps, as the typed rotation. */}
      <HStack gap={1.5} marginTop={3.5} align="baseline" wrap="wrap">
        <Text fontFamily="mono" fontSize="12px" color="fg.muted">
          Or
        </Text>
        {/* The typed phrase IS a control: clicking it hands the current
            suggestion to Langy (or opens its surface). */}
        <chakra.button
          type="button"
          onClick={onPhrase}
          aria-label={
            canAsk ? `Ask Langy: ${action.phrase}` : `Learn more: ${action.phrase}`
          }
          fontFamily="mono"
          fontSize="12px"
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
        <chakra.a
          href={project ? action.href(project.slug) : undefined}
          onClick={onLearnMore}
          fontFamily="mono"
          fontSize="12px"
          color="fg.muted"
          cursor="pointer"
          whiteSpace="nowrap"
          marginLeft={1}
          borderBottomWidth="1px"
          borderColor="transparent"
          transition="color 130ms ease, border-color 130ms ease"
          _hover={{ color: "fg", borderColor: "fg.muted" }}
        >
          Learn more →
        </chakra.a>
        {canAsk ? (
          <LangyHandOff label="Do it with Langy" onClick={() => askLangy(action.ask)} />
        ) : null}
      </HStack>
    </chakra.div>
  );
}

/** The one Langy hand-off look, shared so the two routes cannot drift. */
function LangyHandOff({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
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
      {label}
    </chakra.button>
  );
}
