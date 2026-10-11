import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { getRawColorValue, useColorModeValue } from "@langwatch/design-system/color-mode";
import { LangyMark } from "@langwatch/design-system/langy-mark";
import { Box, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { MeshGradient } from "@paper-design/shaders-react";
import {
  motion,
  type MotionValue,
  type Transition,
  useAnimationFrame,
  useMotionValue,
} from "motion/react";
import {
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { IconType } from "react-icons";
import { LuMic, LuZap } from "react-icons/lu";

import { useLangyStore } from "../../../../behavior/langy/langy.store.ts";
import { useProjectHomeHost } from "../../../../model/project-home-host.ts";

// ---- Timing knobs -------------------------------------------------------

/**
 * Langy's own palette, for the lantern's ground when there is no announcement
 * lighting it. The shader cannot read CSS variables, so these are resolved hex
 * exactly like every slide's.
 */
const LANTERN_COLORS = ["accent.solid", "orange.muted", "purple.solid"];

/**
 * The Langy mark as the homebar announcement's identity — its own instance, deliberately
 * NOT the panel's. Same grey as every other slide's glyph: quiet identification, not branding.
 */
const LANGY_HOMEBAR_MARK_GRADIENT_ID = "langy-homebar-mark-grad";

function LangyHomebarMark() {
  return (
    <Box display="inline-flex" alignItems="center">
      <svg width="0" height="0" aria-hidden style={{ position: "absolute", pointerEvents: "none" }}>
        <defs>
          <linearGradient id={LANGY_HOMEBAR_MARK_GRADIENT_ID} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--chakra-colors-fg-muted)" />
            <stop offset="100%" stopColor="var(--chakra-colors-fg-muted)" />
          </linearGradient>
        </defs>
      </svg>
      <LangyMark size={14} gradientId={LANGY_HOMEBAR_MARK_GRADIENT_ID} />
    </Box>
  );
}

/**
 * The Langy announcement, carried only by the Langy home. It names the loop the agent actually
 * runs end to end (read the traces, find the cause, open the pull request), because that IS the
 * loop: see the GitHub skill and the matching row in the panel's own suggestions.
 */
const LANGY_SLIDE: Slide = {
  id: "langy-ships-the-fix",
  storagePrefix: "langwatch:langy-home-banner-dismissed:v1:",
  colors: ["accent.solid", "orange.muted", "purple.solid", "bg.subtle"],
  mesh: {
    distortion: 0.9,
    swirl: 0.7,
    scale: 1.15,
    offsetX: -0.12,
    offsetY: 0.16,
    rotation: 42,
  },
  // Langy's own face, not a stock sparkle: the mark on its own violet tile,
  // so the Langy announcement is recognisably HIM against the orange chrome
  // every other slide shares. See LangyHomebarMark.
  iconNode: <LangyHomebarMark />,
  heading: "Langy can ship the fix, not just find it",
  badge: "New",
  ctaLabel: "Ask Langy to investigate",
  posthogEvent: "langy_banner_click",
  navigate: ({ askLangy }) =>
    askLangy?.(
      "Investigate the most important problem in this project from the last 24 hours, explain what changed, and show me the affected traces.",
    ),
};

/** Dwell per slide before it advances. */
const DWELL_MS = 9000;
/** One duration governs the whole slide change: the gradient morphs its palette
 *  + shape while the copy crossfades, both over this same window and easing, so
 *  a change reads as a single coordinated dissolve rather than two competing
 *  motions on different clocks. */
const TRANSITION_MS = 750;
const TRANSITION_S = TRANSITION_MS / 1000;
/** Shared ease-in-out (CSS-standard bezier) for the copy crossfade; mirrors the
 *  gradient morph's symmetric easeInOut so both sides of the change feel as one. */
const TRANSITION_EASE = [0.42, 0, 0.58, 1] as const;
/** Time-constant for the auto-advance easing to a stop (reduced motion) instead of cutting out. */
const SPEED_TAU = 0.32;
/** GPU health probe: sample fps between warmup and warmup+window; below the
 *  floor we treat the GPU as too weak and freeze the shader (CSS base only). */
const PERF_WARMUP_MS = 1500;
const PERF_WINDOW_MS = 1500;
const PERF_MIN_FPS = 28;

// ---- Slide definitions --------------------------------------------------

interface NavCtx {
  /** The host's navigation. A package never pushes a route itself. */
  go: (to: string) => void;
  projectSlug?: string;
  /**
   * Start a Langy conversation in place. Present only where Langy is, which is
   * why it is optional: a slide that needs it is only ever in the rotation for
   * readers who have it.
   */
  askLangy?: (prompt: string) => void;
}

interface Slide {
  id: string;
  /** Per-project localStorage key prefix for the 7-day snooze. */
  storagePrefix: string;
  /** Semantic colours resolved before they reach the WebGL shader. */
  colors: string[];
  /** Canvas shape + position, interpolated alongside the colours so the blob
   *  drifts, rotates and reshapes between slides, not just recolours. */
  mesh: {
    distortion: number;
    swirl: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
  };
  /** The icon-slot glyph — either a react-icons component… */
  Icon?: IconType;
  /** …or an arbitrary node (a brand mark). */
  iconNode?: React.ReactNode;
  heading: string;
  /** The pill next to the heading ("New", "Coming soon"). Absent = no pill. */
  badge?: string;
  ctaLabel: string;
  /** Shader speed while this slide is active (default 0.45). */
  speed?: number;
  posthogEvent: string;
  navigate: (ctx: NavCtx) => void;
}

const SLIDES: Slide[] = [
  {
    id: "automations",
    storagePrefix: "langwatch:automations-home-banner-dismissed:v1:",
    colors: ["orange.fg", "accent.solid", "red.solid", "orange.subtle"],
    mesh: {
      distortion: 0.92,
      swirl: 0.5,
      scale: 1.25,
      offsetX: -0.22,
      offsetY: 0.14,
      rotation: 68,
    },
    Icon: LuZap,
    heading: "React the moment it matters",
    badge: "New",
    ctaLabel: "Explore automations",
    posthogEvent: "automations_banner_click",
    navigate: ({ go, projectSlug }) => go(`/${projectSlug}/automations`),
  },
  {
    id: "voice-agents",
    storagePrefix: "langwatch:voice-agents-home-banner-dismissed:v1:",
    colors: ["teal.solid", "cyan.solid", "purple.solid", "cyan.subtle"],
    mesh: {
      distortion: 0.85,
      swirl: 0.62,
      scale: 1.2,
      offsetX: 0.2,
      offsetY: -0.18,
      rotation: 108,
    },
    Icon: LuMic,
    heading: "Voice agent simulations are here",
    badge: "New",
    ctaLabel: "Try voice agent testing",
    posthogEvent: "voice_agents_banner_click",
    navigate: () =>
      window.open(
        "https://langwatch.ai/scenario/voice/getting-started",
        "_blank",
        "noopener,noreferrer",
      ),
  },
];

/**
 * Which announcements this home is carrying. Langy is never PROMOTED here. A banner inviting
 * someone to try Langy, sat directly above a composer that already is Langy, is the same offer
 * made twice, and the banner is the worse of the two.
 */
function useSlides(
  _projectId: string | undefined,
  { includeLangy }: { includeLangy: boolean },
): Slide[] {
  return useMemo(() => (includeLangy ? [LANGY_SLIDE, ...SLIDES] : SLIDES), [includeLangy]);
}

// ---- Colour / shape interpolation ---------------------------------------

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function lerpColor(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
}

function lerpPalette(a: string[], b: string[], t: number): string[] {
  return a.map((c, i) => lerpColor(c, b[i] ?? c, t));
}

type Mesh = Slide["mesh"];
type MorphState = { from: string[]; fromMesh: Mesh; start: number | null };
type PerformanceState = { start: number | null; frames: number; done: boolean };
function lerpMesh(a: Mesh, b: Mesh, t: number): Mesh {
  return {
    distortion: lerp(a.distortion, b.distortion, t),
    swirl: lerp(a.swirl, b.swirl, t),
    scale: lerp(a.scale, b.scale, t),
    offsetX: lerp(a.offsetX, b.offsetX, t),
    offsetY: lerp(a.offsetY, b.offsetY, t),
    rotation: lerp(a.rotation, b.rotation, t),
  };
}

function probeBannerPerformance(
  performance: PerformanceState,
  time: number,
  instant: boolean,
): boolean {
  if (performance.done || instant || time < PERF_WARMUP_MS) return false;
  if (performance.start === null) {
    performance.start = time;
    return false;
  }

  performance.frames++;
  const elapsed = time - performance.start;
  if (elapsed < PERF_WINDOW_MS) return false;
  performance.done = true;
  return (performance.frames / elapsed) * 1000 < PERF_MIN_FPS;
}

function applyBannerMorph({
  displayColorsRef,
  displayMeshRef,
  instant,
  morphRef,
  setDisplayColors,
  setDisplayMesh,
  targetColors,
  targetMesh,
  time,
}: {
  displayColorsRef: MutableRefObject<string[]>;
  displayMeshRef: MutableRefObject<Mesh>;
  instant: boolean;
  morphRef: MutableRefObject<MorphState | null>;
  setDisplayColors: Dispatch<SetStateAction<string[]>>;
  setDisplayMesh: Dispatch<SetStateAction<Mesh>>;
  targetColors: string[];
  targetMesh: Mesh | undefined;
  time: number;
}) {
  const morph = morphRef.current;
  if (!morph || instant) return;
  if (morph.start === null) morph.start = time;
  const amount = clamp01((time - morph.start) / TRANSITION_MS);
  const easedAmount = easeInOut(amount);
  const colors = targetColors.length
    ? lerpPalette(morph.from, targetColors, easedAmount)
    : morph.from;
  const mesh = lerpMesh(morph.fromMesh, targetMesh ?? morph.fromMesh, easedAmount);
  displayColorsRef.current = colors;
  displayMeshRef.current = mesh;
  setDisplayColors(colors);
  setDisplayMesh(mesh);
  if (amount >= 1) morphRef.current = null;
}

function useBannerMorph({
  displayColorsRef,
  displayMeshRef,
  instant,
  isDark,
  morphRef,
  progress,
  setDisplayColors,
  setDisplayMesh,
  slide,
  speedRef,
  targetColors,
  targetMesh,
}: {
  displayColorsRef: MutableRefObject<string[]>;
  displayMeshRef: MutableRefObject<Mesh>;
  instant: boolean;
  isDark: boolean;
  morphRef: MutableRefObject<MorphState | null>;
  progress: MotionValue<number>;
  setDisplayColors: Dispatch<SetStateAction<string[]>>;
  setDisplayMesh: Dispatch<SetStateAction<Mesh>>;
  slide: Slide | undefined;
  speedRef: MutableRefObject<number>;
  targetColors: string[];
  targetMesh: Mesh | undefined;
}) {
  useEffect(() => {
    if (!slide) return;
    if (instant) {
      morphRef.current = null;
      displayColorsRef.current = targetColors;
      if (targetMesh) displayMeshRef.current = targetMesh;
      setDisplayColors(targetColors);
      if (targetMesh) setDisplayMesh(targetMesh);
      progress.set(0);
      return;
    }
    morphRef.current = {
      from: displayColorsRef.current.length ? displayColorsRef.current : targetColors,
      fromMesh: displayMeshRef.current,
      start: null,
    };
    progress.set(0);
    speedRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.id, isDark, instant]);
}

function useBannerAnimation({
  displayColorsRef,
  displayMeshRef,
  eligibleLenRef,
  instantRef,
  morphRef,
  perfRef,
  progress,
  reduceMotionRef,
  setDisplayColors,
  setDisplayMesh,
  setIndex,
  setLowPerf,
  speedRef,
  targetColorsRef,
  targetMeshRef,
}: {
  displayColorsRef: MutableRefObject<string[]>;
  displayMeshRef: MutableRefObject<Mesh>;
  eligibleLenRef: MutableRefObject<number>;
  instantRef: MutableRefObject<boolean>;
  morphRef: MutableRefObject<MorphState | null>;
  perfRef: MutableRefObject<PerformanceState>;
  progress: MotionValue<number>;
  reduceMotionRef: MutableRefObject<boolean>;
  setDisplayColors: Dispatch<SetStateAction<string[]>>;
  setDisplayMesh: Dispatch<SetStateAction<Mesh>>;
  setIndex: Dispatch<SetStateAction<number>>;
  setLowPerf: Dispatch<SetStateAction<boolean>>;
  speedRef: MutableRefObject<number>;
  targetColorsRef: MutableRefObject<string[]>;
  targetMeshRef: MutableRefObject<Mesh | undefined>;
}) {
  useAnimationFrame((time, delta) => {
    if (eligibleLenRef.current === 0) return;
    const deltaSeconds = delta / 1000;
    if (probeBannerPerformance(perfRef.current, time, instantRef.current)) setLowPerf(true);

    const wantsMovement = !reduceMotionRef.current && eligibleLenRef.current > 1;
    const targetSpeed = wantsMovement ? 1 : 0;
    speedRef.current +=
      (targetSpeed - speedRef.current) * (1 - Math.exp(-deltaSeconds / SPEED_TAU));

    if (eligibleLenRef.current > 1) {
      const nextProgress = progress.get() + (delta / DWELL_MS) * speedRef.current;
      if (nextProgress >= 1) {
        progress.set(0);
        setIndex((current) => current + 1);
      } else {
        progress.set(nextProgress);
      }
    }

    applyBannerMorph({
      displayColorsRef,
      displayMeshRef,
      instant: instantRef.current,
      morphRef,
      setDisplayColors,
      setDisplayMesh,
      targetColors: targetColorsRef.current,
      targetMesh: targetMeshRef.current,
      time,
    });
  });
}

// ---- The carousel -------------------------------------------------------

/**
 * The home-page announcement slot, as a morphing carousel. Rotates through every eligible slide
 * (each owns its own per-project 7-day snooze).
 */
export function HomePageBanners({ children }: { children?: ReactNode }) {
  const host = useProjectHomeHost();
  const project = host.project();
  const projectId = project?.id;
  const projectSlug = project?.slug;
  const analytics = useUiAnalytics();
  const navigate = host.navigate.bind(host);
  const reduceMotion = host.reducedMotion();
  const isDark = useColorModeValue(false, true);

  // An announcement about Langy is noise to a reader who cannot reach Langy.
  const slides = useSlides(projectId, { includeLangy: host.langyVisibility().show });
  const askLangy = useLangyStore((s) => s.askLangy);

  const [hasMounted, setHasMounted] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Every slide, always. An announcement stands until it is taken out of the
  // rotation in code — there is no per-reader dismissal to filter by, so
  // there is nothing to work out here.
  const eligible = slides;
  const active = eligible.length > 0 ? index % eligible.length : 0;
  const slide = eligible[active];

  // Target palette + shape for the active slide, resolved for the theme.
  const [targetColors, setTargetColors] = useState<string[]>([]);
  const [themeLanternColors, setThemeLanternColors] = useState<string[]>([]);
  useEffect(() => {
    setTargetColors(slide?.colors.map(getRawColorValue) ?? []);
    setThemeLanternColors(LANTERN_COLORS.map(getRawColorValue));
  }, [slide, isDark]);
  const targetMesh = slide?.mesh;

  // What the canvas is CURRENTLY showing (mid-morph). Seeded to the target so
  // the first paint is stable.
  const [displayColors, setDisplayColors] = useState<string[]>(targetColors);
  const [displayMesh, setDisplayMesh] = useState<Mesh>(targetMesh ?? SLIDES[0]!.mesh);
  // Flips true once we measure the shader running below the fps floor — a
  // GPU that can't keep up. From then on the canvas stops animating.
  const [lowPerf, setLowPerf] = useState(false);

  // Snap instead of tween when the user prefers reduced motion or the GPU is
  // struggling: no shader animation, no colour/shape morph, no vapor.
  const instant = reduceMotion || lowPerf;

  // Countdown 0..1 as a motion value so the ring redraws without re-rendering.
  const progress = useMotionValue(0);

  // Refs the animation-frame loop reads so it never runs on stale state.
  const speedRef = useRef(0);
  const eligibleLenRef = useRef(eligible.length);
  const reduceMotionRef = useRef(reduceMotion);
  const instantRef = useRef(instant);
  const targetColorsRef = useRef(targetColors);
  const targetMeshRef = useRef(targetMesh);
  const displayColorsRef = useRef(displayColors);
  const displayMeshRef = useRef(displayMesh);
  const morphRef = useRef<MorphState | null>(null);
  const perfRef = useRef<PerformanceState>({
    start: null,
    frames: 0,
    done: false,
  });

  eligibleLenRef.current = eligible.length;
  reduceMotionRef.current = reduceMotion;
  instantRef.current = instant;
  targetColorsRef.current = targetColors;
  targetMeshRef.current = targetMesh;

  useBannerMorph({
    displayColorsRef,
    displayMeshRef,
    instant,
    isDark,
    morphRef,
    progress,
    setDisplayColors,
    setDisplayMesh,
    slide,
    speedRef,
    targetColors,
    targetMesh,
  });

  useBannerAnimation({
    displayColorsRef,
    displayMeshRef,
    eligibleLenRef,
    instantRef,
    morphRef,
    perfRef,
    progress,
    reduceMotionRef,
    setDisplayColors,
    setDisplayMesh,
    setIndex,
    setLowPerf,
    speedRef,
    targetColorsRef,
    targetMeshRef,
  });

  // Nothing renders until the project resolves: the snooze map is keyed per project, so before
  // `projectId` exists every slide would look eligible — snoozed users would see a flash, and
  // the CTA would push /undefined/... The lantern is the exception to "no slide, no banner": it
  // is the block the composer lives in, so it still has to render once every announcement has
  // been dismissed. It just renders without a chrome line.
  if (!hasMounted || !projectId) return null;

  const handleCta = (slideToOpen: Slide) => {
    analytics.track({
      name: slideToOpen.posthogEvent,
      attributes: { surface: "home_banner", projectId },
    });
    // Following the link is NOT dismissing the announcement. It used to snooze the slide for a
    // week, which meant the people most interested in a feature were the ones who lost the way
    // back to it: one click to look, and the link was gone from their home page. Interest is
    // not "seen it, thanks". Only the explicit dismiss (the X) snoozes, which is the control
    // that actually says so.
    slideToOpen.navigate({ go: navigate, projectSlug, askLangy });
  };

  const colors = displayColors.length ? displayColors : targetColors;
  // The lantern is lit whether or not there is anything to announce, so when
  // every slide has been dismissed it falls back to Langy's own palette rather
  // than going dark. Same canvas, different bed.
  const lanternColors = colors.length >= 3 ? colors : themeLanternColors;
  const multi = eligible.length > 1;
  const selectSlide = (nextIndex: number) => {
    setIndex((nextIndex + eligible.length) % eligible.length);
    progress.set(0);
  };
  // Enter and exit run at once so the two lots of copy dissolve THROUGH each
  // other, sharing the tile morph's duration and easing so the whole change
  // lands as one motion. Instant when snapping for reduced motion / weak GPU.
  const slideTransition = instant
    ? { duration: 0 }
    : { duration: TRANSITION_S, ease: TRANSITION_EASE };

  const bannerProps: BannerViewProps = {
    active,
    colors,
    displayMesh,
    eligible,
    handleCta,
    lanternColors,
    lowPerf,
    multi,
    progress,
    reduceMotion,
    selectSlide,
    slide,
    slideTransition,
  };

  return <LanternBanner {...bannerProps}>{children}</LanternBanner>;
}

interface BannerViewProps {
  active: number;
  colors: string[];
  displayMesh: Mesh;
  eligible: Slide[];
  handleCta: (slide: Slide) => void;
  lanternColors: string[];
  lowPerf: boolean;
  multi: boolean;
  progress: MotionValue<number>;
  reduceMotion: boolean;
  selectSlide: (index: number) => void;
  slide: Slide | undefined;
  slideTransition: Transition;
}

function CarouselOnly({ children, multi }: { children: ReactNode; multi: boolean }) {
  if (!multi) return null;
  return children;
}

function LanternBanner({
  active,
  children,
  displayMesh,
  eligible,
  handleCta,
  lanternColors,
  lowPerf,
  multi,
  progress,
  reduceMotion,
  selectSlide,
  slide,
}: BannerViewProps & { children?: ReactNode }) {
  return (
    <Box position="relative" width="full">
      {/* Light bloom background; bleeds past box intentionally as the source
            of illumination for the hero. Both bleed layers sit at zIndex -1:
            they light the page from behind, so neighbours never paint under
            them. They stay visible only inside HomePage's zIndex={1} Container. */}
      <Box
        aria-hidden
        position="absolute"
        zIndex={-1}
        insetInline={{ base: "-8%", md: "-14%" }}
        insetBlock={{ base: "-30%", md: "-45%" }}
        pointerEvents="none"
        opacity={{ base: 0.3, _dark: 0.45 }}
        // Softer on light. On a pale ground the mesh's bands keep their
        // edges and read as banding rather than as light; blurring takes the
        // edges off without touching the colours. Dark needs none of it —
        // the same blur there only muddies a field that already reads as
        // depth.
        filter={{ base: "blur(15px)", _dark: "blur(5px)" }}
        css={{
          maskImage: "radial-gradient(58% 62% at 50% 46%, currentColor 12%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(58% 62% at 50% 46%, currentColor 12%, transparent 72%)",
        }}
      >
        {lowPerf ? (
          <Box
            position="absolute"
            inset={0}
            style={{
              background: `linear-gradient(120deg, ${lanternColors[0]}, ${lanternColors[1]} 45%, ${lanternColors[2]})`,
            }}
          />
        ) : (
          <Box position="absolute" inset={0}>
            <MeshGradient
              colors={lanternColors}
              distortion={displayMesh.distortion}
              swirl={displayMesh.swirl}
              offsetX={displayMesh.offsetX}
              offsetY={displayMesh.offsetY}
              rotation={displayMesh.rotation}
              grainMixer={0.12}
              grainOverlay={0.12}
              speed={reduceMotion ? 0 : (slide?.speed ?? 0.45)}
              scale={displayMesh.scale}
              style={{ width: "100%", height: "100%" }}
            />
          </Box>
        )}
      </Box>

      {/* Light mode white bloom; keeps the greeting zone clean and readable. */}
      <Box
        aria-hidden
        position="absolute"
        zIndex={-1}
        insetInline={{ base: "-8%", md: "-14%" }}
        insetBlock={{ base: "-30%", md: "-45%" }}
        pointerEvents="none"
        display={{ base: "block", _dark: "none" }}
        background="radial-gradient(62% 64% at 50% 28%, var(--chakra-colors-bg) 0%, var(--chakra-colors-bg) 52%, transparent 78%)"
      />

      <VStack
        position="relative"
        zIndex={1}
        align="center"
        /* Wider than the hero's own rhythm on purpose: the ticker is an
             aside, not the next line of the block above it, and the pause
             before it is what says so. */
        gap={9}
        paddingX={{ base: 4, md: 5 }}
        paddingY={{ base: 8, md: 12 }}
      >
        {children}

        <VStack gap={1}>
          {/* What is new, as a ticker rather than a bar.
                It sits BELOW the field now. An announcement is the least
                important thing on a page whose job is to take a question, and it
                was previously the first line in the block with the only coloured
                link in it — so the eye landed on this and not on the field. */}
          {/* Fixed width prevents ticker jump on each rotation. */}
          {slide ? (
            <VStack gap="7px" width="min(520px, 100%)" align="stretch">
              {/* The line. One target: the arrow is the affordance, so the
                    announcement stops carrying a second small button beside a
                    label that already says the same thing. The verb survives as
                    the accessible name. */}
              <chakra.button
                type="button"
                onClick={() => handleCta(slide)}
                aria-label={slide.ctaLabel}
                display="flex"
                alignItems="center"
                gap={2.5}
                width="full"
                minHeight="20px"
                background="transparent"
                borderWidth={0}
                padding={0}
                cursor="pointer"
                textAlign="left"
                css={{
                  "&:hover .langy-ticker-arrow": {
                    transform: "translateX(3px)",
                    color: "var(--chakra-colors-orange-fg)",
                  },
                }}
              >
                <Box flexShrink={0} color="fg.muted" display="grid">
                  {slide.iconNode ?? (slide.Icon ? <slide.Icon size={14} /> : null)}
                </Box>
                {slide.badge ? (
                  <chakra.span flexShrink={0} textStyle="micro" fontWeight="600" color="accent.fg">
                    {slide.badge}
                  </chakra.span>
                ) : null}
                <Text
                  textStyle="bodySm"
                  color="fg.muted"
                  truncate
                  /* A flex child's min-width is `auto`, so without this it
                       refuses to shrink below its own text and pushes the row
                       wide instead of ellipsing. */
                  minWidth={0}
                  flex="1"
                >
                  {slide.heading}
                </Text>
                <chakra.span
                  className="langy-ticker-arrow"
                  aria-hidden
                  flexShrink={0}
                  color="fg.subtle"
                  textStyle="caption"
                  lineHeight="1"
                  transition="transform 130ms ease, color 130ms ease"
                >
                  &#8594;
                </chakra.span>
              </chakra.button>

              {/* Pagination is a span waterfall: each segment is an equal dwell, so
                    shown ones read complete and the live one fills across its own
                    dwell (the same `progress` value the auto-advance runs on) while
                    ahead ones stay empty track — one object, not dots plus a timer. */}
              {/* The hit area is 16px tall; the mark inside it is 2px. Bled
                    back out with a negative margin so buying a real click
                    target costs the layout nothing — the rule sits exactly
                    where it did, with more pointer either side of it. A 2px
                    target is decoration you are invited to miss. */}
              <CarouselOnly multi={multi}>
                <HStack gap="5px" width="full" height="16px" marginTop="-7px" marginBottom="-7px">
                  {eligible.map((_, i) => (
                    <Box
                      key={i}
                      as="button"
                      aria-label={`Show announcement ${i + 1} of ${eligible.length}`}
                      aria-current={i === active ? "true" : undefined}
                      onClick={() => selectSlide(i)}
                      flex="1"
                      height="full"
                      display="flex"
                      alignItems="center"
                      background="transparent"
                      cursor="pointer"
                      // The mark answers the pointer anywhere in the tall
                      // box, so the target reads as the size it truly is.
                      css={{
                        "&:hover .langy-ticker-segment": {
                          background: "var(--chakra-colors-fg-muted)",
                        },
                      }}
                    >
                      <Box
                        className="langy-ticker-segment"
                        width="full"
                        height="2px"
                        borderRadius="full"
                        overflow="hidden"
                        // Three bright chunks with gaps read as a progress control — steps to
                        // get through — which is the wrong promise for pagination. A hairline
                        // at low alpha recedes to being punctuation: seen when you look at
                        // it, never competing with the sentence above.
                        background={i === active ? "fg.muted/40" : "fg.muted/15"}
                        transition="background 200ms ease"
                        /* The fill's accent, resolved per colour mode here
                             because the motion.div below takes a raw style
                             object that cannot carry Chakra conditionals. */
                        css={{
                          "--ticker-accent": "var(--chakra-colors-accent-fg)",
                          _dark: {
                            "--ticker-accent": "var(--chakra-colors-orange-fg)",
                          },
                        }}
                      >
                        {i === active ? (
                          <motion.div
                            style={{
                              height: "100%",
                              // The same orange as NEW. The accent appearing
                              // exactly twice — the word, and the segment it
                              // belongs to — is what ties the two rows into
                              // one object rather than a line and a widget.
                              background: "var(--ticker-accent)",
                              scaleX: progress,
                              transformOrigin: "left",
                            }}
                          />
                        ) : null}
                      </Box>
                    </Box>
                  ))}
                </HStack>
              </CarouselOnly>
            </VStack>
          ) : null}
        </VStack>
      </VStack>
    </Box>
  );
}
