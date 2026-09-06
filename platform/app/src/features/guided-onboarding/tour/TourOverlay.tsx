/**
 * What the guided tour paints on the page: the lit rectangle over the step's
 * target, Langy's cursor travelling to it, and the caption that explains it.
 *
 * Presentational only. Each of these takes what to draw and where, and knows
 * nothing about steps advancing, timers or the tour store. The engine that
 * drives them is in TourLayer.
 */
import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { Castle, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { TourHandoff } from "./guidedTourStore";
import {
  EASING,
  type Point,
  type Rect,
  TOUR_CHROME_Z,
  TOUR_HANDOFF_FADE_MS,
  TOUR_TRAVEL_MS,
} from "./tourGeometry";
import { readMs, type TourStep } from "./tourSteps";

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

/** The lit rectangle, and the dim over everything else. */
export function TourSpotlight({
  spot,
  spotZ,
  handoff,
}: {
  spot: Rect;
  spotZ: number;
  handoff: TourHandoff;
}) {
  const transition = [
    `left ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `top ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `width ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `height ${TOUR_TRAVEL_MS}ms ${EASING}`,
    `box-shadow ${TOUR_TRAVEL_MS}ms ease`,
    `opacity ${TOUR_HANDOFF_FADE_MS}ms ease`,
  ].join(", ");
  return (
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
        transition,
      }}
    />
  );
}

/** Langy's cursor, with its name tag and the click ripple. */
export function TourCursor({
  cursor,
  moves,
  step,
  arrived,
  ripple,
}: {
  cursor: Point;
  moves: number;
  step: TourStep | undefined;
  arrived: boolean;
  ripple: number;
}) {
  return (
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
          moves > 1 ? `transform ${TOUR_TRAVEL_MS}ms ${EASING}` : "none",
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
  );
}

/** The step's words, with back, skip and next. */
export function TourCaption({
  caption,
  step,
  stepIndex,
  steps,
  onBack,
  onSkip,
  onNext,
}: {
  caption: Point;
  step: TourStep;
  stepIndex: number;
  steps: readonly TourStep[];
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  return (
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
        <chakra.button
          type="button"
          onClick={onBack}
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
        </chakra.button>
        <HStack gap={1.5}>
          <chakra.button
            type="button"
            onClick={onSkip}
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
          </chakra.button>
          <chakra.button
            type="button"
            onClick={onNext}
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
          </chakra.button>
        </HStack>
      </HStack>
    </Box>
  );
}
