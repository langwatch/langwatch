import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { COMPOSER_ANCHOR_ATTR } from "../components/Composer";
import {
  glowRectFor,
  midpointRect,
  type MorphRect,
  readRect,
  readRectAtRest,
} from "../logic/composerMorphGeometry";
import { useLangyStore } from "../stores/langyStore";

/**
 * How long the travelling copy stays up.
 *
 * The spring itself (PANEL_LAYOUT_TRANSITION) settles in a little over 400ms;
 * the copy then crossfades out over the panel composer that is already sitting
 * underneath it. Both numbers are a description of that spring rather than a
 * second opinion about it, which is why the copy hands over on a timer instead
 * of on the spring's own completion: the handover has to happen at the pixels,
 * and by this point it is there.
 */
const SETTLE_MS = 420;
const HANDOVER_MS = 140;

export interface ComposerFlight {
  /** Where the home page's composer was standing when the reader sent. */
  origin: MorphRect;
  /** The panel composer's resting box, measured through the closed transform. */
  destination: MorphRect;
  /** The warm copy of the block's light, riding behind the bar. */
  glow: MorphRect;
  /** A static copy of the question, carried for the first part of the trip. */
  text: string;
}

/**
 * The home page's send, as one object moving.
 *
 * The state seam is `askLangy(prompt)`, which already opens the panel, clears
 * the conversation and queues the question for the panel to send. Everything
 * here is a visual layer over that: no new path, no second way to start a turn.
 *
 * What travels is a GHOST — a copy of the composer, `aria-hidden` and inert.
 * The tempting alternative, a shared framer `layoutId` across the two real
 * composers, does not survive contact: projection SCALES the element it moves,
 * and this element contains a focused textarea, so the caret geometry and any
 * in-flight IME composition break mid-morph. The panel's own outer box is
 * already projecting too, and nesting projections across a `position: fixed`
 * boundary is exactly where that machinery gets fragile. A copy on explicit
 * rects has none of those problems, at the cost of being hand-rolled.
 *
 * Hooks return state and callbacks; the consumer renders the ghost.
 *
 * Spec: specs/home/langy-home-morph.feature
 */
export function useComposerMorph({
  heroCardRef,
  /** Dev preview: hold the copy halfway instead of letting it land. */
  hold = false,
  /** Dev preview: take the reduced-motion path without changing the OS. */
  forceReducedMotion = false,
}: {
  heroCardRef: React.RefObject<HTMLDivElement | null>;
  hold?: boolean;
  forceReducedMotion?: boolean;
}) {
  const askLangy = useLangyStore((s) => s.askLangy);
  const isOpen = useLangyStore((s) => s.isOpen);
  const systemReduceMotion = useReducedMotion();
  const reduceMotion = systemReduceMotion || forceReducedMotion;

  const [flight, setFlight] = useState<ComposerFlight | null>(null);
  // What a screen reader is told, since the animation says it to everyone else.
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** The panel's composer, wherever it is mounted. */
  const findPanelComposer = () =>
    document.querySelector<HTMLElement>(`[${COMPOSER_ANCHOR_ATTR}="panel"]`);

  const focusPanelComposer = useCallback(() => {
    findPanelComposer()?.querySelector("textarea")?.focus();
  }, []);

  const ask = useCallback(
    (prompt: string) => {
      const question = prompt.trim();
      if (!question) return;

      const heroCard = heroCardRef.current;
      const panelComposer = findPanelComposer();

      // Measured BEFORE the store changes, while the home page's composer is
      // still standing where the reader last saw it.
      const origin = heroCard ? readRect(heroCard) : null;

      // Three ways to skip the travel, and all of them are the right answer:
      // the reader asked for less motion; the panel is already open, so there
      // is no journey to make (the same gesture must not mean two different
      // things); or one of the two ends is simply not on the page.
      const skip = reduceMotion || isOpen || !origin || !panelComposer;

      askLangy(question);
      setAnnouncement(`Asking Langy: ${question}`);

      if (skip) {
        clearTimers();
        setFlight(null);
        // Still hand over the caret: whatever brought the panel up, the next
        // thing the reader types belongs in it.
        timers.current.push(setTimeout(focusPanelComposer, SETTLE_MS));
        return;
      }

      // One frame after the panel has been told to open, so its resting layout
      // (which for the floating card depends on the conversation it now has)
      // is the one being measured. The transform is suppressed for the read,
      // so the closed pose never leaks into the destination.
      requestAnimationFrame(() => {
        const anchor = findPanelComposer();
        if (!anchor) return;
        const measured = readRectAtRest(anchor);
        const destination = hold
          ? midpointRect(origin, measured)
          : measured;

        setFlight({
          origin,
          destination,
          glow: glowRectFor(origin),
          text: question,
        });

        if (hold) return;
        clearTimers();
        timers.current.push(
          setTimeout(focusPanelComposer, SETTLE_MS),
          setTimeout(() => setFlight(null), SETTLE_MS + HANDOVER_MS),
        );
      });
    },
    [
      askLangy,
      clearTimers,
      focusPanelComposer,
      heroCardRef,
      hold,
      isOpen,
      reduceMotion,
    ],
  );

  return {
    /** Non-null while the copy is in the air. */
    flight,
    /** True from send until the copy has handed over. */
    isFlying: flight !== null,
    reduceMotion,
    announcement,
    ask,
  };
}
