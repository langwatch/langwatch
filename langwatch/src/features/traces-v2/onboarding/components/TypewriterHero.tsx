import { Heading, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useState } from "react";
import { applyAuroraTextShimmer, BlinkingCursor } from "./heroText";

/**
 * Typewriter cadence — quicker than original 38/22/420/1500. Faster typing
 * pushes through the "I'm about to learn something" preamble so the user
 * lands at the *exploration* beats sooner.
 */
const TYPEWRITER_HEADING_MS = 36;
const TYPEWRITER_SUBHEAD_MS = 18;
const TYPEWRITER_GAP_MS = 280;
const TYPEWRITER_LINGER_MS = 900;

interface TypewriterHeroProps {
  heading: string;
  subhead?: string;
  /**
   * How long to hold the fully-typed text on screen before calling
   * `onDone`. The journey config exposes this via the stage's `holdMs`
   * field — different beats want different breathing room.
   */
  lingerMs?: number;
  onDone: () => void;
  /**
   * Freeze the typing/linger machine in place — used while the
   * IntegrateDrawer is open so the marquee beats don't tick past
   * behind it. Resumes from where it was paused.
   */
  paused?: boolean;
}

/**
 * Two-stage typewriter — heading types char-by-char, then a brief pause,
 * then subhead types char-by-char. Once everything is on screen we linger
 * for `lingerMs` and call `onDone` (which advances the journey to the next
 * stage). A blinking cursor sits at the active typing position.
 */
export function TypewriterHero({
  heading,
  subhead,
  lingerMs = TYPEWRITER_LINGER_MS,
  onDone,
  paused = false,
}: TypewriterHeroProps): React.ReactElement {
  type Phase = "heading" | "gap" | "subhead" | "linger" | "done";
  const [headingShown, setHeadingShown] = useState(0);
  const [subheadShown, setSubheadShown] = useState(0);
  const [phase, setPhase] = useState<Phase>("heading");

  // Reset on prop change so a stage swap restarts the animation.
  useEffect(() => {
    setHeadingShown(0);
    setSubheadShown(0);
    setPhase("heading");
  }, [heading, subhead]);

  useEffect(() => {
    if (paused) return;
    if (phase === "heading") {
      if (headingShown >= heading.length) {
        setPhase(subhead ? "gap" : "linger");
        return;
      }
      const t = setTimeout(
        () => setHeadingShown((s) => s + 1),
        TYPEWRITER_HEADING_MS,
      );
      return () => clearTimeout(t);
    }
    if (phase === "gap") {
      const t = setTimeout(() => setPhase("subhead"), TYPEWRITER_GAP_MS);
      return () => clearTimeout(t);
    }
    if (phase === "subhead") {
      if (!subhead || subheadShown >= subhead.length) {
        setPhase("linger");
        return;
      }
      const t = setTimeout(
        () => setSubheadShown((s) => s + 1),
        TYPEWRITER_SUBHEAD_MS,
      );
      return () => clearTimeout(t);
    }
    if (phase === "linger") {
      const t = setTimeout(() => setPhase("done"), lingerMs);
      return () => clearTimeout(t);
    }
    if (phase === "done") {
      onDone();
    }
  }, [
    phase,
    headingShown,
    subheadShown,
    heading,
    subhead,
    lingerMs,
    onDone,
    paused,
  ]);

  const headingTyping = phase === "heading";
  const subheadTyping = phase === "subhead";

  return (
    <VStack align="center" gap={4} maxWidth="58ch" textAlign="center">
      <Heading
        fontSize={{ base: "3xl", md: "4xl" }}
        letterSpacing="-0.035em"
        fontWeight={400}
        lineHeight="1.05"
        color="fg"
        whiteSpace="pre-line"
      >
        {applyAuroraTextShimmer(heading.slice(0, headingShown))}
        {headingTyping && <BlinkingCursor />}
      </Heading>
      {subhead && (
        <Text
          color="fg.muted"
          textStyle="md"
          lineHeight="1.65"
          maxWidth="48ch"
          minHeight="1.65em"
        >
          {applyAuroraTextShimmer(subhead.slice(0, subheadShown))}
          {subheadTyping && <BlinkingCursor color="fg.muted" />}
        </Text>
      )}
    </VStack>
  );
}
