import { useReducedMotion } from "@langwatch/langy-browser-kit";
import { nowInstant } from "@langwatch/time";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

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

type PointerDrag = { isOnScrollbar: boolean; topEdge: number; pointerId: number };

/**
 * Answers one question about a scroller: could the reader be the cause of the upward movement
 * being reported right now? A wheel up, an upward key, a finger dragging the column up, or a
 * pointer drag on the scrollbar or above the column counts, for a short window.
 */
class ReaderGestures {
  private readonly controller = new AbortController();
  private lastUpwardAt = 0;
  private touchY: number | undefined;
  // `drag` is tested on its own rather than through `drag?.pointerId`: a synthetic
  // pointer event need not carry a `pointerId`, and two undefineds compare equal.
  private drag: PointerDrag | undefined;

  constructor(private readonly el: HTMLElement) {
    const opts = { passive: true, signal: this.controller.signal };
    el.addEventListener("wheel", this.onWheel, opts);
    el.addEventListener("keydown", this.onKeyDown, opts);
    el.addEventListener("touchstart", this.onTouchStart, opts);
    el.addEventListener("touchmove", this.onTouchMove, opts);
    el.addEventListener("pointerdown", this.onPointerDown, opts);
    // On the window: only the PRESS has to land on the column; the drag is followed anywhere.
    window.addEventListener("pointermove", this.onPointerMove, opts);
    window.addEventListener("pointerup", this.onPointerUp, opts);
    window.addEventListener("pointercancel", this.onPointerUp, opts);
  }

  droveTheColumnUp(): boolean {
    return nowInstant().epochMilliseconds - this.lastUpwardAt <= USER_GESTURE_WINDOW_MS;
  }

  dispose(): void {
    this.controller.abort();
  }

  private markUpward(): void {
    this.lastUpwardAt = nowInstant().epochMilliseconds;
  }

  private readonly onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) this.markUpward();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (UPWARD_KEYS.has(event.key)) this.markUpward();
  };

  private readonly onTouchStart = (event: TouchEvent) => {
    this.touchY = event.touches[0]?.clientY;
  };

  // A finger travelling DOWN the glass drags the column up.
  private readonly onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    if (this.touchY !== undefined && y > this.touchY) this.markUpward();
    this.touchY = y;
  };

  // Touch reports its own direction above, so a resting finger is not a drag.
  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    this.drag = {
      isOnScrollbar: event.target === this.el,
      topEdge: this.el.getBoundingClientRect().top,
      pointerId: event.pointerId,
    };
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.isOnScrollbar || event.clientY < drag.topEdge) this.markUpward();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.drag && event.pointerId === this.drag.pointerId) this.drag = undefined;
  };
}

/** Whether the scroller sits at the live edge, and whether it has anywhere to go. */
function measureScroller(el: HTMLElement) {
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  return {
    atBottom: distanceFromBottom <= BOTTOM_THRESHOLD_PX,
    overflows: el.scrollHeight - el.clientHeight > 1,
  };
}

/**
 * Bring the live edge into view. The instant path assigns `scrollTop`, which needs no layout and
 * is the only thing that works where the platform offers no smooth scrolling.
 */
function scrollToLiveEdge({
  el,
  end,
  behavior,
}: {
  el: HTMLElement;
  end: HTMLElement | null;
  behavior: ScrollBehavior;
}): void {
  if (behavior !== "smooth" || !end?.scrollIntoView) {
    el.scrollTop = el.scrollHeight;
    return;
  }
  end.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
}

/**
 * One scroll to the live edge per frame. The guard is a SEPARATE flag raised BEFORE the rAF is
 * requested, so a burst of content changes queues exactly one scroll.
 */
class LiveEdgeScheduler {
  private scheduled = false;
  private frame: number | undefined;

  constructor(
    private readonly scrollRef: RefObject<HTMLDivElement | null>,
    private readonly endRef: RefObject<HTMLDivElement | null>,
  ) {}

  request(behavior: ScrollBehavior): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.frame = requestAnimationFrame(() => {
      this.scheduled = false;
      this.frame = undefined;
      const el = this.scrollRef.current;
      if (el) scrollToLiveEdge({ el, end: this.endRef.current, behavior });
    });
  }

  cancel(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
  }
}

/**
 * The pin is RELEASED by the reader scrolling up, and RE-ENGAGED by arriving at the bottom.
 * Nothing else touches it.
 */
function watchPin({
  el,
  setPinned,
  setCanScroll,
}: {
  el: HTMLElement;
  setPinned: (pinned: boolean) => void;
  setCanScroll: (canScroll: boolean) => void;
}): () => void {
  let lastTop = el.scrollTop;
  const gestures = new ReaderGestures(el);
  const onScroll = () => {
    const { atBottom, overflows } = measureScroller(el);
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
  const [scheduler] = useState(() => new LiveEdgeScheduler(scrollRef, endRef));
  const reduceMotion = useReducedMotion();
  const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";

  // The ref is what the ResizeObserver reads (outside React's render, so it must see
  // the CURRENT value); the state is what the UI renders. `setPinned` keeps them in step.
  const pinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const [canScroll, setCanScroll] = useState(false);

  const setPinned = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setIsPinned((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => () => scheduler.cancel(), [scheduler]);

  const jumpToLatest = useCallback(() => {
    setPinned(true);
    scheduler.request(behavior);
  }, [behavior, scheduler, setPinned]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) return watchPin({ el, setPinned, setCanScroll });
  }, [setPinned]);

  // Content got taller (a token, a card, a status line) — follow it, while we hold the pin.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setCanScroll(measureScroller(el).overflows);
      if (enabled && pinnedRef.current) scheduler.request(behavior);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [behavior, scheduler, enabled]);

  return { scrollRef, contentRef, endRef, isPinned, canScroll, jumpToLatest };
}
