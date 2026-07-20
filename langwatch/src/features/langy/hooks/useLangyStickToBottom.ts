import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * Follow-the-stream scrolling for the Langy message column.
 *
 * WHY A ResizeObserver AND NOT AN EFFECT ON `messages`:
 * the old autoscroll was `useEffect(..., [messages, status])`, which assumed
 * every growth of the column passes through `messages`. It doesn't. The granular
 * turn signals (status / progress / metrics) come off `useLangyTurnSignals`, and
 * the capability + activity cards render off tool parts — neither of which
 * changed the effect's deps. So the column grew and the scroller never moved, and
 * the answer streamed off the bottom of the panel.
 *
 * Chasing that with a longer dep list is a losing game: the next thing anyone
 * streams in breaks it again. So the trigger is the one thing that is true of
 * ALL of them — the content got taller. A ResizeObserver on the content element
 * cannot be defeated by a new growth source.
 *
 * NEVER FIGHT THE USER: auto-follow is engaged only while the viewport is at
 * (or within `BOTTOM_THRESHOLD_PX` of) the bottom. The moment someone scrolls up
 * to read, we release and stop moving the scroller under them; when they come
 * back to the bottom, we re-engage. `isPinned` + `canScroll` drive the
 * "jump to latest" affordance, which is the only way back to the live edge
 * without manual scrolling.
 */

/**
 * How close to the bottom still counts as "at the bottom".
 *
 * Not zero: sub-pixel layout, a scrollbar's rounding, and the browser's own
 * rounding of `scrollHeight - scrollTop - clientHeight` all mean an
 * exactly-bottomed scroller frequently reports a residue of a pixel or two. A
 * small tolerance also means a user who scrolls a hair off the bottom stays
 * followed rather than being surprised by a dead stream.
 */
const BOTTOM_THRESHOLD_PX = 40;

export interface LangyStickToBottom {
  /** Attach to the scrolling element (`overflow-y: auto`). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the element INSIDE the scroller whose height tracks content. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to an empty sentinel as the LAST child of the content. */
  endRef: React.RefObject<HTMLDivElement | null>;
  /** True while auto-follow is engaged (the viewport is at the live edge). */
  isPinned: boolean;
  /** True when the content actually overflows — i.e. there is somewhere to go. */
  canScroll: boolean;
  /** Return to the live edge and re-engage auto-follow. */
  jumpToLatest: () => void;
}

export function useLangyStickToBottom({
  enabled = true,
}: {
  /**
   * False when the column is a DOCUMENT rather than a stream (the inline
   * model setup, the card gallery): reading starts at the TOP, so auto-follow
   * must not drag the heading off-screen as the content mounts and grows.
   * Manual scrolling still works; the pin simply never pulls.
   */
  enabled?: boolean;
} = {}): LangyStickToBottom {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  /** A scroll is already queued for the next frame — see scrollToEnd. */
  const scheduledRef = useRef(false);
  const reduceMotion = useReducedMotion();

  // The ref is what the ResizeObserver reads (it fires outside React's render,
  // and must see the CURRENT value, not one closed over at subscribe time); the
  // state is what the UI renders. They are kept in lockstep by `setPinned`.
  const pinnedRef = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [isPinned, setIsPinned] = useState(true);
  const [canScroll, setCanScroll] = useState(false);

  const setPinned = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setIsPinned((prev) => (prev === next ? prev : next));
  }, []);

  const measure = useCallback((el: HTMLElement) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return {
      atBottom: distanceFromBottom <= BOTTOM_THRESHOLD_PX,
      overflows: el.scrollHeight - el.clientHeight > 1,
    };
  }, []);

  /**
   * Bring the live edge into view, smoothly.
   *
   * `scrollIntoView` on a bottom sentinel rather than assigning `scrollTop`: it
   * animates, and a repeated call RETARGETS the in-flight animation instead of
   * restarting it — which is what makes continuous following during a token
   * stream read as one smooth glide rather than a stutter.
   *
   * Coalesced to one call per animation frame. Tokens can land several times
   * per frame, and asking the browser to re-aim the same scroll three times
   * before it has painted once is pure waste.
   *
   * `block: "end"` pins the sentinel to the bottom edge; `inline: "nearest"`
   * forbids any sideways scrolling. The panel is `position: fixed`, so the
   * document itself never has to move to satisfy this.
   */
  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    // The guard is a SEPARATE flag, not `frameRef.current !== null`, and it is
    // raised BEFORE the rAF is requested. Guarding on the frame id is a latch
    // waiting to happen: `frameRef.current = requestAnimationFrame(cb)` assigns
    // the id only AFTER `cb` has returned, so any rAF that runs its callback
    // synchronously leaves the id written back over the `null` the callback just
    // set — and every later call sees a non-null id and returns early. The
    // scroller would follow exactly one growth and then silently stop forever.
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    frameRef.current = requestAnimationFrame(() => {
      scheduledRef.current = false;
      frameRef.current = null;
      const el = scrollRef.current;
      const end = endRef.current;
      if (!el) return;

      // The instant path never needs `scrollIntoView` — assigning `scrollTop` is
      // exactly as correct, has no dependency on the element being laid out, and
      // is the only thing that works when the platform has no smooth scrolling
      // to offer. Reduced-motion users and non-browser environments land here.
      if (behavior !== "smooth" || !end?.scrollIntoView) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      end.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest",
      });
    });
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const jumpToLatest = useCallback(() => {
    setPinned(true);
    scrollToEnd(reduceMotion ? "auto" : "smooth");
  }, [reduceMotion, scrollToEnd, setPinned]);

  /**
   * The pin is RELEASED by scrolling up, and RE-ENGAGED by arriving at the
   * bottom. Nothing else touches it.
   *
   * The obvious implementation — `setPinned(atBottom)` on every scroll event —
   * is broken by our own smooth scrolling: a smooth `scrollIntoView` emits a
   * scroll event for every intermediate position, and every one of those is
   * "not at the bottom yet". It would therefore release the pin mid-glide, on
   * the very animation that was honouring it, and auto-follow would die after
   * the first token.
   *
   * Direction is what actually separates the two cases. Our programmatic scroll
   * only ever moves DOWN, toward the bottom; a user who wants out of the stream
   * scrolls UP. So: moving up releases, reaching the bottom engages, and
   * everything in between (including our own animation in flight) leaves the pin
   * exactly as it was.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;

    const onScroll = () => {
      const { atBottom, overflows } = measure(el);
      const movedUp = el.scrollTop < lastTop - 1;
      lastTop = el.scrollTop;

      setCanScroll(overflows);
      if (atBottom) setPinned(true);
      else if (movedUp) setPinned(false);
    };

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [measure, setPinned]);

  // Content got taller (a token, a card, a status line, anything) — follow it,
  // but only if we still hold the pin.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      setCanScroll(measure(el).overflows);
      if (!enabledRef.current || !pinnedRef.current) return;
      scrollToEnd(reduceMotion ? "auto" : "smooth");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure, reduceMotion, scrollToEnd]);

  return { scrollRef, contentRef, endRef, isPinned, canScroll, jumpToLatest };
}
