/**
 * The guided tour layer: a collaborator cursor tagged "(langy)" that moves
 * over the real UI, a spotlight around the current target, and a caption per
 * stop. Nothing needs a click: the Next button carries a circle timer sized
 * for a slow read and the tour advances by itself. Skip ends it; either way
 * the spotlight then hands the screen to the Langy panel.
 *
 * Mounted once by GuidedOnboardingHost; renders nothing unless a tour is
 * running or handing off.
 *
 * Stacking: during the tour the spotlight sits above the drawer layer (the
 * gateway tour opens the create drawer and the secret dialog) and above the
 * docked panel, so the whole screen dims except the target. At handoff it
 * drops just below the panel so the panel is what stays lit. Cursor and
 * caption ride above both.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnalyticsBoundary, useAnalytics } from "react-contextual-analytics";
import { useRouter } from "~/utils/compat/next-router";
import type { GuidedPath } from "../paths";
import {
  type TourEndStatus,
  type TourHandoff,
  useGuidedTourStore,
} from "./guidedTourStore";
import { TourCaption, TourCursor, TourSpotlight } from "./TourOverlay";
import {
  PANEL_SELECTOR,
  type Point,
  type Rect,
  TOUR_ACTION_CEILING_MS,
  TOUR_HANDOFF_FADE_MS,
  TOUR_HANDOFF_FALLBACK_Z,
  TOUR_HANDOFF_HOLD_MS,
  TOUR_MISSING_TARGET_MS,
  TOUR_SETTLE_MS,
  TOUR_SPOTLIGHT_Z,
  TOUR_TARGET_POLL_MS,
  TOUR_TRAVEL_MS,
} from "./tourGeometry";
import { getTourActions } from "./tourRegistry";
import {
  readMs,
  TOUR_STEPS,
  type TourStep,
  type TourStepContext,
} from "./tourSteps";

function targetRect(target: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  const rect = el?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect : null;
}

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

function padded(rect: DOMRect, pad: number): Rect {
  return {
    x: rect.left - pad,
    y: rect.top - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
  };
}

interface PendingAction {
  settled: boolean;
}

/** Follows a page action's result when it is a promise; nothing otherwise. */
function trackAction(result: unknown): PendingAction | null {
  if (!result || typeof (result as PromiseLike<unknown>).then !== "function") {
    return null;
  }
  const pending: PendingAction = { settled: false };
  const settle = () => {
    pending.settled = true;
  };
  (result as PromiseLike<unknown>).then(settle, settle);
  return pending;
}

function cursorPoint(rect: DOMRect): Point {
  const big = rect.height > 300 || rect.width > 500;
  return {
    x: big
      ? rect.left + Math.min(rect.width * 0.5, 260)
      : rect.left + rect.width * 0.72,
    y: big
      ? rect.top + Math.min(rect.height * 0.4, 220)
      : rect.top + rect.height * 0.62,
  };
}

function captionPoint(rect: DOMRect, step: TourStep): Point {
  const placement =
    step.placement === "auto"
      ? rect.width >= rect.height
        ? "bottom"
        : "right"
      : step.placement;
  let x = rect.right + 18;
  let y = rect.top + Math.min(rect.height / 2, 140) - 40;
  if (placement === "bottom") {
    x = rect.left + rect.width / 2 - 170;
    y = rect.bottom + 14;
  }
  if (placement === "left") {
    x = rect.left + 60;
    y = rect.top + 80;
  }
  return {
    x: Math.max(16, Math.min(x, window.innerWidth - 380)),
    y: Math.max(16, Math.min(y, window.innerHeight - 220)),
  };
}

/** One below the panel's own stacking order, so the panel is what stays lit. */
function handoffZ(): number {
  const panel = document.querySelector<HTMLElement>(PANEL_SELECTOR);
  if (!panel) return TOUR_HANDOFF_FALLBACK_Z;
  const z = Number.parseInt(window.getComputedStyle(panel).zIndex, 10);
  return Number.isFinite(z) ? z - 1 : TOUR_HANDOFF_FALLBACK_Z;
}

/**
 * The step timers.
 *
 * Every wait a step schedules (travel, caption, auto-advance, the target poll)
 * goes through `later`, so `clear` cancels the whole step at once and no timer
 * outlives the component. A step that scheduled nothing clears to nothing.
 */
function useTourTimers(): {
  later: (fn: () => void, ms: number) => void;
  clear: () => void;
} {
  const timers = useRef<number[]>([]);
  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => clear, [clear]);
  return { later, clear };
}

/**
 * The handoff at the end of a run: the spotlight slides onto the Langy panel
 * and holds there while Langy picks the conversation up, then the dim fades.
 *
 * Its timers are kept apart from the step timers on purpose. The handoff
 * outlives the run that started it, so ending a step must not cancel it, and
 * starting a run must.
 */
function useTourHandoff({
  setSpot,
  setSpotZ,
  setHandoff,
}: {
  setSpot: (rect: Rect | null) => void;
  setSpotZ: (z: number) => void;
  setHandoff: (handoff: TourHandoff) => void;
}): { run: () => void; cancel: () => void } {
  const timers = useRef<number[]>([]);
  const cancel = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const run = useCallback(() => {
    cancel();
    const panel = document
      .querySelector(PANEL_SELECTOR)
      ?.getBoundingClientRect();
    if (!panel || panel.width <= 0) {
      setSpot(null);
      return;
    }
    setSpotZ(handoffZ());
    setSpot(padded(panel, 4));
    setHandoff("lit");
    timers.current.push(
      window.setTimeout(() => setHandoff("fading"), TOUR_HANDOFF_HOLD_MS),
    );
    timers.current.push(
      window.setTimeout(() => {
        setHandoff(null);
        setSpot(null);
        setSpotZ(TOUR_SPOTLIGHT_Z);
      }, TOUR_HANDOFF_HOLD_MS + TOUR_HANDOFF_FADE_MS),
    );
  }, [cancel, setHandoff, setSpot, setSpotZ]);

  useEffect(() => cancel, [cancel]);
  return useMemo(() => ({ run, cancel }), [run, cancel]);
}

/**
 * Everything the tour paints: the lit rectangle, the collaborator cursor and
 * the caption, and the two flags the render reads to animate them.
 *
 * It is one hook rather than seven pieces of state because the three always
 * move together. A step lands on a target and all three go to it; a step waits
 * for a target and all three go away.
 */
function useSpotlight() {
  const [cursor, setCursor] = useState<Point | null>(null);
  const [caption, setCaption] = useState<Point | null>(null);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [spotZ, setSpotZ] = useState(TOUR_SPOTLIGHT_Z);
  const [arrived, setArrived] = useState(false);
  const [ripple, setRipple] = useState(0);
  const lastCursor = useRef<Point | null>(null);

  const moveCursor = useCallback((point: Point) => {
    lastCursor.current = point;
    setCursor(point);
  }, []);

  /** Lights a target and sends the cursor to it, without a caption. */
  const lightTarget = useCallback(
    (rect: DOMRect) => {
      moveCursor(cursorPoint(rect));
      setSpot(padded(rect, 6));
    },
    [moveCursor],
  );

  /** Lights a target, sends the cursor to it and captions it. */
  const captionTarget = useCallback(
    (rect: DOMRect, step: TourStep) => {
      setSpot(padded(rect, 6));
      moveCursor(cursorPoint(rect));
      setCaption(captionPoint(rect, step));
    },
    [moveCursor],
  );

  /**
   * Closes the lit hole onto the cursor while a step waits for its target, so
   * the screen stays dimmed with no lone hole around the previous target.
   */
  const closeOnCursor = useCallback(() => {
    const at = lastCursor.current;
    if (at) setSpot({ x: at.x, y: at.y, w: 0, h: 0 });
  }, []);

  /** A step starts with nothing captioned and nothing marked as arrived. */
  const beginStep = useCallback(() => {
    setArrived(false);
    setCaption(null);
  }, []);

  /** The run is over: the cursor and caption go, the spotlight is the caller's. */
  const clearPointer = useCallback(() => {
    lastCursor.current = null;
    setCursor(null);
    setCaption(null);
    setArrived(false);
  }, []);

  return {
    cursor,
    caption,
    spot,
    spotZ,
    arrived,
    ripple,
    setSpot,
    setSpotZ,
    setArrived,
    rippleOnce: useCallback(() => setRipple((r) => r + 1), []),
    moveCursor,
    lightTarget,
    captionTarget,
    closeOnCursor,
    beginStep,
    clearPointer,
  };
}

/**
 * What a poll that has not found its target yet should do next.
 *
 * While a page action from an earlier step is still answering, the wait does
 * not count down: the target is about to mount, it is not missing. The action
 * has a ceiling of its own so a promise that never settles cannot park the
 * tour for good.
 */
export function pollVerdict({
  pending,
  awaitedAction,
  waited,
  waitMs,
}: {
  pending: { settled: boolean } | null;
  awaitedAction: number;
  waited: number;
  waitMs: number;
}): "poll" | "give-up" {
  if (pending && !pending.settled) {
    return awaitedAction >= TOUR_ACTION_CEILING_MS ? "give-up" : "poll";
  }
  return waited >= waitMs ? "give-up" : "poll";
}

/**
 * One step in flight: what it is showing, what it is waiting for, and the ways
 * it can move the tour on. The phases below take it rather than closing over a
 * component's scope, so each one is a function you can read on its own.
 */
interface StepRun {
  step: TourStep;
  path: GuidedPath;
  stepIndex: number;
  ctx: TourStepContext;
  paint: ReturnType<typeof useSpotlight>;
  later: (fn: () => void, ms: number) => void;
  emit: ReturnType<typeof useAnalytics>["emit"];
  advance: () => void;
  pendingAction: MutableRefObject<PendingAction | null>;
  cursorMoves: MutableRefObject<number>;
  /** How long this step has been looking for a target that is not there yet. */
  wait: { waited: number; awaitedAction: number; closed: boolean };
}

/**
 * While the caption is up the target may still move: a drawer finishing its
 * slide, a list replacing its spinner. The spotlight, cursor and caption
 * follow it.
 */
function followTarget(run: StepRun, from: DOMRect): void {
  let at = from;
  const poll = () => {
    const now = targetRect(run.step.target);
    if (now && !sameRect(now, at)) {
      at = now;
      run.paint.captionTarget(now, run.step);
    }
    run.later(poll, TOUR_TARGET_POLL_MS);
  };
  run.later(poll, TOUR_TARGET_POLL_MS);
}

/**
 * The caption goes on the target's FINAL size: onArrive may have grown it
 * (opening a nav group) after the cursor set off for the old one.
 */
function settleStep(run: StepRun, travelled: DOMRect): void {
  const fresh = targetRect(run.step.target) ?? travelled;
  run.paint.captionTarget(fresh, run.step);
  /* the auto-advance: a slow read, then move on by itself */
  run.later(run.advance, readMs(run.step.text));
  followTarget(run, fresh);
}

/** The cursor has got there: ripple, run onArrive, then caption. */
function arriveStep(run: StepRun, travelled: DOMRect): void {
  run.paint.setArrived(true);
  if (run.step.click) run.paint.rippleOnce();
  const arriveResult = run.step.onArrive?.({
    ...run.ctx,
    actions: getTourActions(),
  });
  if (arriveResult) run.pendingAction.current = trackAction(arriveResult);
  run.later(() => settleStep(run, travelled), run.step.onArrive ? 550 : 150);
}

/** The target is there: light it, fly the cursor over, then arrive. */
function landStep(run: StepRun, rect: DOMRect): void {
  run.emit("viewed", "tour_step", {
    path: run.path,
    step: run.stepIndex,
    target: run.step.target,
  });
  run.cursorMoves.current += 1;
  run.paint.lightTarget(rect);
  run.later(() => arriveStep(run, rect), TOUR_TRAVEL_MS);
}

/**
 * The target is not there yet. The screen stays dimmed with no lone hole
 * around the previous target: the spotlight closes onto the cursor and opens
 * again on the target once it is there. The step gives up once its wait, or
 * the page action's own ceiling, is spent.
 */
function keepWaiting(run: StepRun, retry: () => void): void {
  if (!run.wait.closed) {
    run.wait.closed = true;
    run.paint.closeOnCursor();
  }
  const pending = run.pendingAction.current;
  const verdict = pollVerdict({
    pending,
    awaitedAction: run.wait.awaitedAction,
    waited: run.wait.waited,
    waitMs: run.step.waitMs ?? TOUR_MISSING_TARGET_MS,
  });
  if (verdict === "give-up") {
    run.advance();
    return;
  }
  if (pending && !pending.settled) {
    run.wait.awaitedAction += TOUR_TARGET_POLL_MS;
  } else {
    run.wait.waited += TOUR_TARGET_POLL_MS;
  }
  run.later(retry, TOUR_TARGET_POLL_MS);
}

/** Looks for the step's target, and lands on it or waits for it. */
function measureStep(run: StepRun): void {
  const rect = targetRect(run.step.target);
  if (!rect) {
    keepWaiting(run, () => measureStep(run));
    return;
  }
  run.pendingAction.current = null;
  landStep(run, rect);
}

/**
 * Runs the current step: before() -> measure -> land -> arrive -> caption ->
 * advance.
 *
 * It owns the two things that only a running step has: the page action a step
 * is still waiting on, and how many times the cursor has been placed (the
 * first placement is instant, so the cursor never flies in from a corner).
 */
function useStepEngine({
  active,
  step,
  steps,
  path,
  stepIndex,
  runId,
  paint,
  later,
  clear,
  endTour,
  goToStep,
  emit,
  navigate,
}: {
  active: boolean;
  step: TourStep | undefined;
  steps: readonly TourStep[];
  path: GuidedPath | null;
  stepIndex: number;
  runId: number;
  paint: ReturnType<typeof useSpotlight>;
  later: (fn: () => void, ms: number) => void;
  clear: () => void;
  endTour: (status: TourEndStatus) => void;
  goToStep: (index: number) => void;
  emit: ReturnType<typeof useAnalytics>["emit"];
  navigate: (to: string) => void;
}): { cursorMoves: MutableRefObject<number>; resetRun: () => void } {
  /* the last page action that answers later; the next step waits for it */
  const pendingAction = useRef<PendingAction | null>(null);
  /* the first cursor placement is instant, so it never flies in from a corner */
  const cursorMoves = useRef(0);

  const resetRun = useCallback(() => {
    pendingAction.current = null;
    cursorMoves.current = 0;
  }, []);

  useEffect(() => {
    if (!active || !step || !path) return;
    clear();
    paint.beginStep();

    const ctx: TourStepContext = { navigate, actions: getTourActions() };
    const beforeResult = step.before?.(ctx);
    if (beforeResult) pendingAction.current = trackAction(beforeResult);

    const run: StepRun = {
      step,
      path,
      stepIndex,
      ctx,
      paint,
      later,
      emit,
      advance: () => {
        if (stepIndex + 1 >= steps.length) endTour("completed");
        else goToStep(stepIndex + 1);
      },
      pendingAction,
      cursorMoves,
      wait: { waited: 0, awaitedAction: 0, closed: false },
    };

    /* measure after layout settles: a before() may have navigated */
    later(() => measureStep(run), TOUR_SETTLE_MS);

    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, runId]);

  return { cursorMoves, resetRun };
}

/**
 * A run's lifecycle: it starts on a clean screen, it ends by handing the
 * spotlight to the panel, and both ends are reported.
 *
 * `resetRun` is the engine's, and is called from here rather than from the
 * engine itself so a run is reset in exactly one place: the effect that sees
 * the new runId.
 */
function useTourRun({
  running,
  runId,
  path,
  stepIndex,
  paint,
  clear,
  handoffAnimation,
  endRun,
  setHandoff,
  resetRun,
  emit,
  steps,
  goToStep,
}: {
  running: boolean;
  runId: number;
  path: GuidedPath | null;
  stepIndex: number;
  paint: ReturnType<typeof useSpotlight>;
  clear: () => void;
  handoffAnimation: { run: () => void; cancel: () => void };
  endRun: (status: TourEndStatus) => void;
  setHandoff: (handoff: TourHandoff) => void;
  resetRun: () => void;
  emit: ReturnType<typeof useAnalytics>["emit"];
  steps: readonly TourStep[];
  goToStep: (index: number) => void;
}): {
  endTour: (status: TourEndStatus) => void;
  next: () => void;
  back: () => void;
} {
  const startedAt = useRef(0);

  const endTour = useCallback(
    (status: TourEndStatus) => {
      clear();
      paint.clearPointer();
      /* the menu goes back to how it looked outside the tour */
      getTourActions().restoreGroups?.();
      if (path && status === "completed") {
        emit("completed", "tour", {
          path,
          durationMs: Date.now() - startedAt.current,
        });
      } else if (path) {
        emit("clicked", "tour_skip", { path, step: stepIndex });
      }
      handoffAnimation.run();
      endRun(status);
    },
    [clear, emit, endRun, handoffAnimation, paint, path, stepIndex],
  );

  /* a new run (start or replay) starts from a clean screen */
  useEffect(() => {
    if (!running) return;
    handoffAnimation.cancel();
    setHandoff(null);
    paint.setSpotZ(TOUR_SPOTLIGHT_Z);
    paint.clearPointer();
    resetRun();
    startedAt.current = Date.now();
    if (path) emit("started", "tour", { path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, running]);

  const next = () => {
    if (!path) return;
    emit("clicked", "tour_next", { path, step: stepIndex });
    clear();
    if (stepIndex + 1 >= steps.length) endTour("completed");
    else goToStep(stepIndex + 1);
  };
  const back = () => {
    if (stepIndex === 0 || !path) return;
    emit("clicked", "tour_back", { path, step: stepIndex });
    clear();
    goToStep(stepIndex - 1);
  };

  return { endTour, next, back };
}

export function TourLayer() {
  return (
    <AnalyticsBoundary name="onboarding_guided">
      <TourLayerInner />
    </AnalyticsBoundary>
  );
}

/**
 * The tour's behaviour, in one hook: what the store says, what is painted,
 * the engine that runs a step and the lifecycle of a run.
 *
 * TourLayerInner is then the markup and nothing else, which is what lets the
 * two be read apart.
 */
function useTour() {
  const running = useGuidedTourStore((s) => s.running);
  const path = useGuidedTourStore((s) => s.path);
  const stepIndex = useGuidedTourStore((s) => s.stepIndex);
  const runId = useGuidedTourStore((s) => s.runId);
  const handoff = useGuidedTourStore((s) => s.handoff);
  const goToStep = useGuidedTourStore((s) => s.goToStep);
  const endRun = useGuidedTourStore((s) => s.end);
  const setHandoff = useGuidedTourStore((s) => s.setHandoff);
  const router = useRouter();
  const { emit } = useAnalytics();

  const paint = useSpotlight();
  const { later, clear } = useTourTimers();
  const handoffAnimation = useTourHandoff({
    setSpot: paint.setSpot,
    setSpotZ: paint.setSpotZ,
    setHandoff,
  });

  const steps = path ? TOUR_STEPS[path] : [];
  const step: TourStep | undefined = steps[stepIndex];
  const active = running && !!step;

  /* the engine ends the tour and the run hook resets the engine, so one of
     the two is reached through a ref rather than through a render order
     neither of them has */
  const endTourRef = useRef<(status: TourEndStatus) => void>(() => undefined);
  const { cursorMoves, resetRun } = useStepEngine({
    active,
    step,
    steps,
    path,
    stepIndex,
    runId,
    paint,
    later,
    clear,
    endTour: (status) => endTourRef.current(status),
    goToStep,
    emit,
    navigate: (to: string) => void router.push(to),
  });
  const { endTour, next, back } = useTourRun({
    running,
    runId,
    path,
    stepIndex,
    paint,
    clear,
    handoffAnimation,
    endRun,
    setHandoff,
    resetRun,
    emit,
    steps,
    goToStep,
  });
  endTourRef.current = endTour;

  return {
    ...paint,
    active,
    handoff,
    step,
    steps,
    stepIndex,
    cursorMoves,
    endTour,
    next,
    back,
  };
}

function TourLayerInner() {
  const {
    active,
    handoff,
    spot,
    spotZ,
    cursor,
    caption,
    arrived,
    ripple,
    step,
    steps,
    stepIndex,
    cursorMoves,
    endTour,
    next,
    back,
  } = useTour();

  if (!active && !handoff) return null;

  return (
    <>
      {(active || handoff) && spot && (
        <TourSpotlight spot={spot} spotZ={spotZ} handoff={handoff} />
      )}
      {active && cursor && (
        <TourCursor
          cursor={cursor}
          moves={cursorMoves.current}
          step={step}
          arrived={arrived}
          ripple={ripple}
        />
      )}
      {active && caption && step && (
        <TourCaption
          caption={caption}
          step={step}
          stepIndex={stepIndex}
          steps={steps}
          onBack={back}
          onSkip={() => endTour("skipped")}
          onNext={next}
        />
      )}
    </>
  );
}
