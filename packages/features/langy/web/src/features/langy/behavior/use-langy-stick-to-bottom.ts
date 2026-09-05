import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../../behavior/use-reduced-motion";

/**
 * Follow-the-stream scrolling for the Langy message column.
 */

/**
 * How close to the bottom still counts as "at the bottom".
 */
const BOTTOM_THRESHOLD_PX = 40;

/**
 * How long an upward gesture keeps counting as the cause of what the scroller does
 * next.
 */
const USER_GESTURE_WINDOW_MS = 700;

/** The keys that move a scroller upward. */
const UPWARD_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/**
 * Answers one question about a scroller: could the reader be the cause of the upward
 * movement being reported right now?
 */
function trackReaderGestures(el: HTMLElement) {
  const controller = new AbortController();
  let lastUpwardAt = 0;
  let touchY: number | null = null;
  let drag: {
    isOnScrollbar: boolean;
    topEdge: number;
    pointerId: number;
  } | null = null;

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) lastUpwardAt = Date.now();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (UPWARD_KEYS.has(event.key)) lastUpwardAt = Date.now();
  };
  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    // A finger travelling DOWN the glass drags the column up.
    if (touchY !== null && y > touchY) lastUpwardAt = Date.now();
    touchY = y;
  };
  // Touch reports its own direction above, so a resting finger is not a drag.
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    drag = {
      isOnScrollbar: event.target === el,
      topEdge: el.getBoundingClientRect().top,
      pointerId: event.pointerId,
    };
  };
  // `drag` is tested on its own rather than through `drag?.pointerId`, which
  // reads the same and is not: the types promise every pointer event carries a
  // `pointerId`, a synthetic one need not, and two undefineds comparing equal
  // walks straight into the null.
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.isOnScrollbar || event.clientY < drag.topEdge) {
      lastUpwardAt = Date.now();
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointerId) drag = null;
  };

  const opts = { passive: true, signal: controller.signal };
  el.addEventListener("wheel", onWheel, opts);
  el.addEventListener("keydown", onKeyDown, opts);
  el.addEventListener("touchstart", onTouchStart, opts);
  el.addEventListener("touchmove", onTouchMove, opts);
  el.addEventListener("pointerdown", onPointerDown, opts);
  // On the window: only the PRESS has to land on the column, and the rest of
  // the drag is followed wherever it goes.
  window.addEventListener("pointermove", onPointerMove, opts);
  window.addEventListener("pointerup", onPointerUp, opts);
  window.addEventListener("pointercancel", onPointerUp, opts);

  return {
    droveTheColumnUp: () => Date.now() - lastUpwardAt <= USER_GESTURE_WINDOW_MS,
    dispose: () => controller.abort(),
  };
}

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
   * False when the column is a DOCUMENT rather than a stream (the inline model setup,
   * the card gallery): reading starts at the TOP, so auto-follow must not drag the
   * heading off-screen as the content mounts and grows.
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
   */
  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    // The guard is a SEPARATE flag, not `frameRef.current !== null`, and it is raised
    // BEFORE the rAF is requested.
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
   * The pin is RELEASED by scrolling up, and RE-ENGAGED by arriving at the bottom.
   * Nothing else touches it.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    const gestures = trackReaderGestures(el);

    const onScroll = () => {
      const { atBottom, overflows } = measure(el);
      const movedUp = el.scrollTop < lastTop - 1;
      lastTop = el.scrollTop;

      setCanScroll(overflows);
      if (atBottom) setPinned(true);
      else if (movedUp && gestures.droveTheColumnUp()) setPinned(false);
    };

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      gestures.dispose();
      el.removeEventListener("scroll", onScroll);
    };
  }, [measure, setPinned]);

  // Content got taller (a token, a card, a status line, anything) — follow it,
  // but only if we still hold the pin.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      setCanScroll(measure(el).overflows);
      if (!enabled || !pinnedRef.current) return;
      scrollToEnd(reduceMotion ? "auto" : "smooth");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure, reduceMotion, scrollToEnd, enabled]);

  return { scrollRef, contentRef, endRef, isPinned, canScroll, jumpToLatest };
}
