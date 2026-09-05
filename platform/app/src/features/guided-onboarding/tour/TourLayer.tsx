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
import { Box, HStack, Text } from "@chakra-ui/react";
import { Castle, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnalyticsBoundary, useAnalytics } from "react-contextual-analytics";
import { useRouter } from "~/utils/compat/next-router";
import { type TourEndStatus, useGuidedTourStore } from "./guidedTourStore";
import { getTourActions } from "./tourRegistry";
import { readMs, TOUR_STEPS, type TourStep } from "./tourSteps";

/** How long the cursor and the spotlight take to reach the next target. */
export const TOUR_TRAVEL_MS = 850;
/** Layout settles (a `before` may have navigated) before the target is measured. */
export const TOUR_SETTLE_MS = 350;
/** A step whose target is not on the page moves on after this. */
export const TOUR_MISSING_TARGET_MS = 400;
/** The panel stays lit this long before the dim fades. */
export const TOUR_HANDOFF_HOLD_MS = 4600;
/** The dim fades out over this long. */
export const TOUR_HANDOFF_FADE_MS = 1000;

/** Above Chakra's drawer positioner (1500) and the docked panel (1200), below menus and dialogs' overlay layer (2000+). */
const TOUR_SPOTLIGHT_Z = 1550;
/** The handoff spotlight when the panel's own stacking order cannot be read. */
const TOUR_HANDOFF_FALLBACK_Z = 1150;
const TOUR_CHROME_Z = 1700;

const PANEL_SELECTOR = '[data-tour="langy-panel"]';
const EASING = "cubic-bezier(0.45, 0, 0.2, 1)";

interface Point {
  x: number;
  y: number;
}
interface Rect extends Point {
  w: number;
  h: number;
}

function targetRect(target: string): DOMRect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  const rect = el?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect : null;
}

function padded(rect: DOMRect, pad: number): Rect {
  return {
    x: rect.left - pad,
    y: rect.top - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
  };
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
  let x = rect.right + 18;
  let y = rect.top + Math.min(rect.height / 2, 140) - 40;
  if (step.placement === "bottom") {
    x = rect.left + rect.width / 2 - 170;
    y = rect.bottom + 14;
  }
  if (step.placement === "left") {
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

/* ---------- the circle-timer on the Next button ---------- */

function TimerRing({
  duration,
  playKey,
}: {
  duration: number;
  playKey: number;
}) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setArmed(true)),
    );
    return () => cancelAnimationFrame(raf);
  }, [playKey]);
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      style={{ transform: "rotate(-90deg)" }}
      aria-hidden="true"
    >
      <circle
        cx={8}
        cy={8}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2.5}
      />
      <circle
        cx={8}
        cy={8}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={armed ? 0 : c}
        style={{
          transition: armed ? `stroke-dashoffset ${duration}ms linear` : "none",
        }}
      />
    </svg>
  );
}

/* ---------- the layer ---------- */

export function TourLayer() {
  return (
    <AnalyticsBoundary name="onboarding_guided">
      <TourLayerInner />
    </AnalyticsBoundary>
  );
}

function TourLayerInner() {
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

  const [cursor, setCursor] = useState<Point | null>(null);
  const [caption, setCaption] = useState<Point | null>(null);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [spotZ, setSpotZ] = useState(TOUR_SPOTLIGHT_Z);
  const [arrived, setArrived] = useState(false);
  const [ripple, setRipple] = useState(0);
  const timers = useRef<number[]>([]);
  const handoffTimers = useRef<number[]>([]);
  /* the first cursor placement is instant, so it never flies in from a corner */
  const cursorMoves = useRef(0);
  const startedAt = useRef(0);

  const steps = path ? TOUR_STEPS[path] : [];
  const step: TourStep | undefined = steps[stepIndex];
  const active = running && !!step;

  const clear = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) =>
    timers.current.push(window.setTimeout(fn, ms));

  const endTour = useCallback(
    (status: TourEndStatus) => {
      clear();
      setCursor(null);
      setCaption(null);
      setArrived(false);
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

      /* the spotlight slides onto the panel and holds there while Langy
         picks the conversation up, then the dim fades away */
      const panel = document
        .querySelector(PANEL_SELECTOR)
        ?.getBoundingClientRect();
      for (const t of handoffTimers.current) clearTimeout(t);
      handoffTimers.current = [];
      if (panel && panel.width > 0) {
        setSpotZ(handoffZ());
        setSpot(padded(panel, 4));
        setHandoff("lit");
        handoffTimers.current.push(
          window.setTimeout(() => setHandoff("fading"), TOUR_HANDOFF_HOLD_MS),
        );
        handoffTimers.current.push(
          window.setTimeout(() => {
            setHandoff(null);
            setSpot(null);
            setSpotZ(TOUR_SPOTLIGHT_Z);
          }, TOUR_HANDOFF_HOLD_MS + TOUR_HANDOFF_FADE_MS),
        );
      } else {
        setSpot(null);
      }
      endRun(status);
    },
    [emit, endRun, path, setHandoff, stepIndex],
  );

  useEffect(
    () => () => {
      clear();
      for (const t of handoffTimers.current) clearTimeout(t);
    },
    [],
  );

  /* a new run (start or replay) starts from a clean screen */
  useEffect(() => {
    if (!running) return;
    for (const t of handoffTimers.current) clearTimeout(t);
    handoffTimers.current = [];
    setHandoff(null);
    setSpotZ(TOUR_SPOTLIGHT_Z);
    cursorMoves.current = 0;
    startedAt.current = Date.now();
    if (path) emit("started", "tour", { path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, running]);

  /* drive one step: before() → travel → land (onArrive, caption, timer) */
  useEffect(() => {
    if (!active || !step || !path) return;
    clear();
    setArrived(false);
    setCaption(null);

    const ctx = {
      navigate: (to: string) => void router.push(to),
      actions: getTourActions(),
    };
    step.before?.(ctx);

    const advance = () => {
      if (stepIndex + 1 >= steps.length) endTour("completed");
      else goToStep(stepIndex + 1);
    };

    /* measure after layout settles (a before() may have navigated) */
    later(() => {
      const rect = targetRect(step.target);
      if (!rect) {
        /* target missing: don't strand the tour */
        later(advance, TOUR_MISSING_TARGET_MS);
        return;
      }
      emit("viewed", "tour_step", {
        path,
        step: stepIndex,
        target: step.target,
      });
      cursorMoves.current += 1;
      setCursor(cursorPoint(rect));
      /* spotlight: the target stays lit, the rest dims */
      setSpot(padded(rect, 6));

      later(() => {
        setArrived(true);
        if (step.click) setRipple((r) => r + 1);
        step.onArrive?.({ ...ctx, actions: getTourActions() });

        /* caption near the target, clamped on screen */
        later(
          () => {
            /* onArrive may have grown the target (opening a nav group), so
               the spotlight takes its final size here rather than the one it
               had while the cursor was still travelling */
            const fresh = targetRect(step.target) ?? rect;
            setSpot(padded(fresh, 6));
            setCaption(captionPoint(fresh, step));
            /* the auto-advance: a slow read, then move on by itself */
            later(advance, readMs(step.text));
          },
          step.onArrive ? 550 : 150,
        );
      }, TOUR_TRAVEL_MS);
    }, TOUR_SETTLE_MS);

    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, runId]);

  if (!active && !handoff) return null;

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

  const spotTransition = [
    `left ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `top ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `width ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `height ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `box-shadow ${TOUR_TRAVEL_MS}ms ease`,
    `opacity ${TOUR_HANDOFF_FADE_MS}ms ease`,
  ].join(", ");

  return (
    <>
      {/* the spotlight: target stays lit, everything else dims */}
      {(active || handoff) && spot && (
        <Box
          data-testid="tour-spotlight"
          data-handoff={handoff ?? undefined}
          position="fixed"
          pointerEvents="none"
          borderRadius="xl"
          style={{
            zIndex: spotZ,
            left: spot.x,
            top: spot.y,
            width: spot.w,
            height: spot.h,
            boxShadow: handoff
              ? "0 0 0 200vmax rgb(15 15 30 / 0.5)"
              : "0 0 0 200vmax rgb(15 15 30 / 0.35)",
            opacity: handoff === "fading" ? 0 : 1,
            transition: spotTransition,
          }}
        />
      )}

      {/* the collaborator cursor */}
      {active && cursor && (
        <Box
          data-testid="tour-cursor"
          position="fixed"
          pointerEvents="none"
          zIndex={TOUR_CHROME_Z}
          left={0}
          top={0}
          style={{
            transform: `translate(${cursor.x}px, ${cursor.y}px)`,
            transition:
              cursorMoves.current > 1
                ? `transform ${TOUR_TRAVEL_MS}ms ${EASING}`
                : "none",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            style={{ filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.25))" }}
            aria-hidden="true"
          >
            <path
              d="M5.5 3.2L19.2 11.4c.5.3.4 1-.2 1.2l-5.7 1.6c-.2.05-.35.2-.42.38l-2 5.5c-.22.6-1.08.58-1.26-.04L5 4.1c-.15-.55.4-1.05.9-.9z"
              fill="#ed8926"
              stroke="#fff"
              strokeWidth="1.4"
            />
          </svg>
          <HStack
            as="span"
            display="inline-flex"
            marginLeft={3}
            gap={1}
            borderRadius="full"
            background="#ed8926"
            paddingX={2}
            paddingY={0.5}
            fontSize="10.5px"
            fontWeight="semibold"
            color="white"
            boxShadow="md"
          >
            <Castle size={10} strokeWidth={2.2} aria-hidden="true" />
            (langy)
          </HStack>
          {step?.click && (
            <Box
              key={ripple}
              position="absolute"
              top="-8px"
              left="-8px"
              width="32px"
              height="32px"
              borderRadius="full"
              borderWidth="2px"
              borderStyle="solid"
              borderColor="#ed8926"
              opacity={arrived ? 0.6 : 0}
              animation={
                arrived ? "ping 1s cubic-bezier(0, 0, 0.2, 1) 1" : undefined
              }
            />
          )}
        </Box>
      )}

      {/* the caption */}
      {active && caption && step && (
        <Box
          data-testid="tour-caption"
          position="fixed"
          zIndex={TOUR_CHROME_Z}
          width="340px"
          borderRadius="2xl"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border"
          background="bg.surface"
          padding={4}
          boxShadow="2xl"
          style={{ left: caption.x, top: caption.y }}
        >
          <HStack align="start" gap={2.5}>
            <Box
              as="span"
              marginTop="2px"
              display="flex"
              width="24px"
              height="24px"
              flexShrink={0}
              alignItems="center"
              justifyContent="center"
              borderRadius="lg"
              background="fg"
              color="bg.surface"
            >
              <Castle size={13} strokeWidth={1.8} aria-hidden="true" />
            </Box>
            <Text fontSize="13px" lineHeight="1.6">
              {step.text}
            </Text>
          </HStack>
          <HStack marginTop={3} justify="space-between">
            <Box
              as="button"
              type="button"
              onClick={back}
              disabled={stepIndex === 0}
              aria-label={stepIndex > 0 ? "Back one step" : undefined}
              display="flex"
              alignItems="center"
              gap={0.5}
              borderRadius="md"
              paddingX={1}
              paddingY={0.5}
              fontSize="10.5px"
              color="fg.subtle"
              cursor={stepIndex > 0 ? "pointer" : "default"}
              _hover={
                stepIndex > 0
                  ? { background: "bg.muted", color: "fg.muted" }
                  : undefined
              }
            >
              {stepIndex > 0 && <ChevronLeft size={11} aria-hidden="true" />}
              {stepIndex + 1} of {steps.length}
            </Box>
            <HStack gap={1.5}>
              <Box
                as="button"
                type="button"
                onClick={() => endTour("skipped")}
                cursor="pointer"
                borderRadius="lg"
                paddingX={2.5}
                paddingY={1.5}
                fontSize="12px"
                fontWeight="medium"
                color="fg.muted"
                _hover={{ background: "bg.muted", color: "fg" }}
              >
                Skip
              </Box>
              <Box
                as="button"
                type="button"
                onClick={next}
                display="flex"
                alignItems="center"
                gap={1.5}
                cursor="pointer"
                borderRadius="lg"
                background="fg"
                color="bg.surface"
                paddingX={3}
                paddingY={1.5}
                fontSize="12px"
                fontWeight="semibold"
                _hover={{ opacity: 0.9 }}
              >
                <TimerRing duration={readMs(step.text)} playKey={stepIndex} />
                Next
                <ChevronRight size={13} aria-hidden="true" />
              </Box>
            </HStack>
          </HStack>
        </Box>
      )}
    </>
  );
}
