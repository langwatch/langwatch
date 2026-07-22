import {
  Box,
  Button,
  chakra,
  Heading,
  HStack,
  Icon,
  IconButton,
  Kbd,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { motion, useAnimationFrame, useMotionValue } from "motion/react";
import posthog from "posthog-js";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuArrowLeft,
  LuArrowRight,
  LuMic,
  LuX,
  LuZap,
} from "react-icons/lu";
import { SERIF } from "~/features/asaplangy";
import { LangyMark } from "~/features/langy/components/LangyMark";
import { getIsMac } from "~/features/command-bar/utils/platform";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useRouter } from "~/utils/compat/next-router";
import { useColorModeValue } from "../ui/color-mode";
import { Tooltip } from "../ui/tooltip";

// ---- Timing knobs -------------------------------------------------------

/**
 * Langy's own palette, for the lantern's ground when there is no announcement
 * lighting it. The shader cannot read CSS variables, so these are resolved hex
 * exactly like every slide's.
 */
const LANTERN_COLORS = ["#f56b1a", "#ffb380", "#6e57d2"];
const LANTERN_COLORS_DARK = ["#a8480d", "#f56b1a", "#5b41c2"];

/**
 * The Langy mark as the homebar announcement's identity — its own instance,
 * deliberately NOT the panel's.
 *
 * Different colour: the site's violet brand ramp, not the panel's
 * orange→purple AI gradient, so the homebar reads as the site announcing
 * Langy rather than the panel leaking into the page. Own paint-server id for
 * the same reason the launcher has one — duplicate SVG gradient ids resolve
 * to whichever comes first in the DOM.
 *
 * Same footprint as every other slide's glyph — 14px, bare. The mark's
 * wireframe reads softer this small, but a bigger tile made the banner row
 * change height whenever this slide was the active one, and a row that
 * breathes per-slide costs more than a crisper mark buys. The violet
 * gradient stays: that is what says Langy at any size.
 */
const LANGY_HOMEBAR_MARK_GRADIENT_ID = "langy-homebar-mark-grad";

function LangyHomebarMark() {
  return (
    <Box display="inline-flex" alignItems="center">
      <svg
        width="0"
        height="0"
        aria-hidden
        style={{ position: "absolute", pointerEvents: "none" }}
      >
        <defs>
          <linearGradient
            id={LANGY_HOMEBAR_MARK_GRADIENT_ID}
            x1="0%"
            y1="100%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="#5b41c2" />
            <stop offset="100%" stopColor="#8a76de" />
          </linearGradient>
        </defs>
      </svg>
      <LangyMark size={14} gradientId={LANGY_HOMEBAR_MARK_GRADIENT_ID} />
    </Box>
  );
}

/**
 * The Langy announcement, carried only by the Langy home.
 *
 * It names the loop the agent actually runs end to end (read the traces, find
 * the cause, open the pull request), because that IS the loop: see the GitHub
 * skill and the matching row in the panel's own suggestions. It stops at
 * opening a PR, and so does this copy. Anything further would be a headline
 * the product then fails to deliver.
 */
const LANGY_SLIDE: Slide = {
  id: "langy-ships-the-fix",
  storagePrefix: "langwatch:langy-home-banner-dismissed:v1:",
  colorsLight: ["#f56b1a", "#ffb380", "#6e57d2", "#fff7ed"],
  colorsDark: ["#a8480d", "#f56b1a", "#5b41c2", "#140b06"],
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
  subtitle: (
    <>
      Ask about a failing trace and Langy digs through your data, explains what
      broke, and opens a pull request with the change.
    </>
  ),
  ctaLabel: "Ask Langy to investigate",
  legacyCtaColor: "orange.700",
  posthogEvent: "langy_banner_click",
  navigate: ({ askLangy }) =>
    askLangy?.(
      "Investigate the most important problem in this project from the last 24 hours, explain what changed, and show me the affected traces.",
    ),
};

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
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
/** Time-constant for the hover slow-down: the auto-advance eases to a stop
 *  instead of cutting out, so nothing changes under the pointer. */
const HOVER_TAU = 0.32;
/** GPU health probe: sample fps between warmup and warmup+window; below the
 *  floor we treat the GPU as too weak and freeze the shader (CSS base only). */
const PERF_WARMUP_MS = 1500;
const PERF_WINDOW_MS = 1500;
const PERF_MIN_FPS = 28;

// ---- Slide definitions --------------------------------------------------

interface NavCtx {
  router: ReturnType<typeof useRouter>;
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
  /** Resolved hex colours (the WebGL shader can't read CSS variables). */
  colorsLight: string[];
  colorsDark: string[];
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
  subtitle: React.ReactNode;
  /** An extra row between subtitle and CTA. */
  extra?: React.ReactNode;
  ctaLabel: string;
  /** Show the Langy toggle shortcut as a kbd chip inside the CTA button. */
  showCtaKbd?: boolean;
  /** Text colour of the CTA in the legacy full-colour banner. */
  legacyCtaColor: string;
  /** Shader speed while this slide is active (default 0.45). */
  speed?: number;
  posthogEvent: string;
  navigate: (ctx: NavCtx) => void;
}

const SLIDES: Slide[] = [
  {
    id: "automations",
    storagePrefix: "langwatch:automations-home-banner-dismissed:v1:",
    colorsLight: ["#b45309", "#ea580c", "#e11d48", "#fff7ed"],
    colorsDark: ["#7c2d12", "#9a3412", "#881337", "#1a0f0a"],
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
    subtitle: (
      <>
        React to traces, alert on metrics, or get reports of anything.
        <br />
        Delivered to Slack or email, on the schedule you choose.
      </>
    ),
    ctaLabel: "Explore automations",
    legacyCtaColor: "orange.700",
    posthogEvent: "automations_banner_click",
    navigate: ({ router, projectSlug }) =>
      void router.push(`/${projectSlug}/automations`),
  },
  {
    id: "voice-agents",
    storagePrefix: "langwatch:voice-agents-home-banner-dismissed:v1:",
    colorsLight: ["#0f766e", "#06b6d4", "#6366f1", "#ecfeff"],
    colorsDark: ["#134e4a", "#0e7490", "#312e81", "#0a1424"],
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
    subtitle: (
      <>
        Real voices, real audio, plain-English judges. Works with ElevenLabs,
        OpenAI Realtime, Vapi, and more.
      </>
    ),
    ctaLabel: "Try voice agent testing",
    legacyCtaColor: "teal.700",
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
 * Which announcements this home is carrying.
 *
 * Langy is never PROMOTED here. A banner inviting someone to try Langy, sat
 * directly above a composer that already is Langy, is the same offer made
 * twice, and the banner is the worse of the two. What the Langy home does get
 * is a genuine announcement about what Langy can do, on the same footing as
 * every other feature announcement, and only for the readers who have it: an
 * announcement about a capability you cannot reach is just noise.
 */
function useSlides(
  _projectId: string | undefined,
  { includeLangy }: { includeLangy: boolean },
): Slide[] {
  return useMemo(
    () => (includeLangy ? [LANGY_SLIDE, ...SLIDES] : SLIDES),
    [includeLangy],
  );
}

// ---- Snooze (per-slide, per-project) ------------------------------------

const storageKey = (slide: Slide, projectId: string) =>
  `${slide.storagePrefix}${projectId}`;

function isSlideSnoozed(slide: Slide, projectId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(storageKey(slide, projectId));
    if (!raw) return false;
    const expiresAt = Number(raw);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    return false;
  }
}

function snoozeSlide(slide: Slide, projectId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      storageKey(slide, projectId),
      String(Date.now() + SNOOZE_MS),
    );
  } catch {
    // Best-effort dismissal.
  }
}

// ---- Colour / shape interpolation ---------------------------------------

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

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
  return rgbToHex([
    lerp(A[0], B[0], t),
    lerp(A[1], B[1], t),
    lerp(A[2], B[2], t),
  ]);
}

function lerpPalette(a: string[], b: string[], t: number): string[] {
  return a.map((c, i) => lerpColor(c, b[i] ?? c, t));
}

type Mesh = Slide["mesh"];
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

// ---- The carousel -------------------------------------------------------

/**
 * The home-page announcement slot, as a morphing carousel.
 *
 * Rotates through every eligible slide (each owns its own per-project 7-day
 * snooze). On a change the single shader canvas MORPHS its palette and shape
 * from one slide to the next while the copy crossfades — both on the same clock
 * and easing, so the whole thing lands as one coordinated dissolve rather than
 * two separate animations.
 *
 * A radial countdown ring shows time to the next slide. Hovering eases the
 * auto-advance to a gentle stop (never a hard cut), so nothing changes under
 * the pointer; leaving eases it back up. Reduced-motion holds on one slide
 * with the dots still available. Renders nothing when every slide is snoozed.
 */
export function HomePageBanners({
  variant = "briefing",
  children,
}: {
  /**
   * `lantern` is the Langy home's block: this component keeps owning the one
   * shared canvas, the announcement compresses to a single line of chrome
   * across the top, and `children` (the composer and its capability row) are
   * laid over the same ground beneath it. It is a variant rather than a second
   * component precisely so there is never a second canvas on the page.
   */
  variant?: "briefing" | "legacy" | "lantern";
  /** Lantern only: what sits under the chrome line, over the same ground. */
  children?: ReactNode;
}) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectId = project?.id;
  const projectSlug = project?.slug;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const isDark = useColorModeValue(false, true);

  // The lantern variant only ever renders on the Langy home, so it is the
  // honest signal for "this reader has Langy" without re-deriving the gate.
  const slides = useSlides(projectId, { includeLangy: variant === "lantern" });
  const askLangy = useLangyStore((s) => s.askLangy);

  const [hasMounted, setHasMounted] = useState(false);
  const [snoozed, setSnoozed] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const next: Record<string, boolean> = {};
    for (const slide of slides)
      next[slide.id] = isSlideSnoozed(slide, projectId);
    setSnoozed(next);
  }, [projectId, slides]);

  const eligible = useMemo(
    () => slides.filter((slide) => !snoozed[slide.id]),
    [snoozed, slides],
  );
  const active = eligible.length > 0 ? index % eligible.length : 0;
  const slide = eligible[active];

  // Target palette + shape for the active slide, resolved for the theme.
  const targetColors = useMemo(
    () => (slide ? (isDark ? slide.colorsDark : slide.colorsLight) : []),
    [slide, isDark],
  );
  const targetMesh = slide?.mesh;

  // What the canvas is CURRENTLY showing (mid-morph). Seeded to the target so
  // the first paint is stable.
  const [displayColors, setDisplayColors] = useState<string[]>(targetColors);
  const [displayMesh, setDisplayMesh] = useState<Mesh>(
    targetMesh ?? SLIDES[0]!.mesh,
  );
  // Flips true once we measure the shader running below the fps floor — a
  // GPU that can't keep up. From then on the canvas stops animating.
  const [lowPerf, setLowPerf] = useState(false);

  // Snap instead of tween when the user prefers reduced motion or the GPU is
  // struggling: no shader animation, no colour/shape morph, no vapor.
  const instant = reduceMotion || lowPerf;

  // Countdown 0..1 as a motion value so the ring redraws without re-rendering.
  const progress = useMotionValue(0);

  // Refs the animation-frame loop reads so it never runs on stale state.
  const hoveredRef = useRef(false);
  const speedRef = useRef(0);
  const eligibleLenRef = useRef(eligible.length);
  const reduceMotionRef = useRef(reduceMotion);
  const instantRef = useRef(instant);
  const targetColorsRef = useRef(targetColors);
  const targetMeshRef = useRef(targetMesh);
  const displayColorsRef = useRef(displayColors);
  const displayMeshRef = useRef(displayMesh);
  const morphRef = useRef<{
    from: string[];
    fromMesh: Mesh;
    start: number | null;
  } | null>(null);
  const perfRef = useRef<{
    start: number | null;
    frames: number;
    done: boolean;
  }>({
    start: null,
    frames: 0,
    done: false,
  });

  eligibleLenRef.current = eligible.length;
  reduceMotionRef.current = reduceMotion;
  instantRef.current = instant;
  targetColorsRef.current = targetColors;
  targetMeshRef.current = targetMesh;

  // On slide (or theme) change, kick off a morph from the current canvas to
  // the new target and restart the countdown. When snapping (reduced motion /
  // weak GPU) we jump straight to the target instead.
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
      from: displayColorsRef.current.length
        ? displayColorsRef.current
        : targetColors,
      fromMesh: displayMeshRef.current,
      start: null,
    };
    progress.set(0);
    speedRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.id, isDark, instant]);

  useAnimationFrame((time, delta) => {
    if (eligibleLenRef.current === 0) return;
    const dt = delta / 1000;

    // GPU health probe: count frames over a window once warmed up, and drop
    // to the static base if we're not clearing the fps floor. Skipped when
    // already snapping (the shader isn't animating, so fps is meaningless).
    const perf = perfRef.current;
    if (!perf.done && !instantRef.current && time >= PERF_WARMUP_MS) {
      if (perf.start === null) {
        perf.start = time;
      } else {
        perf.frames++;
        const elapsed = time - perf.start;
        if (elapsed >= PERF_WINDOW_MS) {
          perf.done = true;
          if ((perf.frames / elapsed) * 1000 < PERF_MIN_FPS) setLowPerf(true);
        }
      }
    }

    // Ease the advance speed toward its target (0 while hovered / reduced /
    // single-slide, 1 otherwise) so hovering slows to a stop, not a cut.
    const wantMoving =
      !hoveredRef.current &&
      !reduceMotionRef.current &&
      eligibleLenRef.current > 1;
    const targetSpeed = wantMoving ? 1 : 0;
    speedRef.current +=
      (targetSpeed - speedRef.current) * (1 - Math.exp(-dt / HOVER_TAU));

    if (eligibleLenRef.current > 1) {
      const p = progress.get() + (delta / DWELL_MS) * speedRef.current;
      if (p >= 1) {
        progress.set(0);
        setIndex((i) => i + 1);
      } else {
        progress.set(p);
      }
    }

    // Morph the canvas palette + shape toward the live target (skipped while
    // snapping for reduced motion / weak GPU).
    const morph = morphRef.current;
    if (morph && !instantRef.current) {
      if (morph.start === null) morph.start = time;
      const t = clamp01((time - morph.start) / TRANSITION_MS);
      const e = easeInOut(t);
      const to = targetColorsRef.current;
      const toMesh = targetMeshRef.current ?? morph.fromMesh;
      const cols = to.length ? lerpPalette(morph.from, to, e) : morph.from;
      const mesh = lerpMesh(morph.fromMesh, toMesh, e);
      displayColorsRef.current = cols;
      displayMeshRef.current = mesh;
      setDisplayColors(cols);
      setDisplayMesh(mesh);
      if (t >= 1) morphRef.current = null;
    }
  });

  // Nothing renders until the project resolves: the snooze map is keyed per
  // project, so before `projectId` exists every slide would look eligible —
  // snoozed users would see a flash, and the CTA would push /undefined/...
  //
  // The lantern is the exception to "no slide, no banner": it is the block the
  // composer lives in, so it still has to render once every announcement has
  // been dismissed. It just renders without a chrome line.
  if (!hasMounted || !projectId) return null;
  if (variant !== "lantern" && (eligible.length === 0 || !slide)) return null;

  const dismiss = (slideToHide: Slide) => {
    if (projectId) snoozeSlide(slideToHide, projectId);
    setSnoozed((s) => ({ ...s, [slideToHide.id]: true }));
    setIndex(0);
  };

  const handleCta = (slideToOpen: Slide) => {
    posthog.capture(slideToOpen.posthogEvent, {
      surface: "home_banner",
      projectId,
    });
    // Following the link is NOT dismissing the announcement. It used to snooze
    // the slide for a week, which meant the people most interested in a feature
    // were the ones who lost the way back to it: one click to look, and the
    // link was gone from their home page. Interest is not "seen it, thanks".
    // Only the explicit dismiss (the X) snoozes, which is the control that
    // actually says so.
    slideToOpen.navigate({ router, projectSlug, askLangy });
  };

  const colors = displayColors.length ? displayColors : targetColors;
  // The lantern is lit whether or not there is anything to announce, so when
  // every slide has been dismissed it falls back to Langy's own palette rather
  // than going dark. Same canvas, different bed.
  const lanternColors =
    colors.length >= 3 ? colors : isDark ? LANTERN_COLORS_DARK : LANTERN_COLORS;
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

  if (variant === "lantern") {
    return (
      <Box
        position="relative"
        width="full"
        isolation="isolate"
        onMouseEnter={() => (hoveredRef.current = true)}
        onMouseLeave={() => (hoveredRef.current = false)}
      >
        {/* The ground: light, not a panel.

            This used to be a bordered card with the shader held at 13% behind a
            flat gradient of the same colours. Two gradients multiplied down to
            a whisper do not read as a moving mesh, they read as a tint — the
            animation was there the whole time and could not be seen. So the
            card is gone, the flat gradient is now only the fallback for a
            machine that cannot run the shader, and what is left runs bright
            enough to actually be light: a bloom behind the field that dissolves
            into the page long before it reaches any text.

            It bleeds past its own box on purpose. The hero is not an object on
            the home, it is where the home is lit from. */}
        <Box
          aria-hidden
          position="absolute"
          insetInline={{ base: "-8%", md: "-14%" }}
          insetBlock={{ base: "-30%", md: "-45%" }}
          pointerEvents="none"
          opacity={{ base: 0.3, _dark: 0.55 }}
          // Softer on light. On a pale ground the mesh's bands keep their
          // edges and read as banding rather than as light; blurring takes the
          // edges off without touching the colours. Dark needs none of it —
          // the same blur there only muddies a field that already reads as
          // depth.
          filter={{ base: "blur(15px)", _dark: "none" }}
          css={{
            maskImage:
              "radial-gradient(58% 62% at 50% 46%, #000 12%, transparent 72%)",
            WebkitMaskImage:
              "radial-gradient(58% 62% at 50% 46%, #000 12%, transparent 72%)",
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

        <VStack
          position="relative"
          zIndex={1}
          align="center"
          gap={5}
          paddingX={{ base: 4, md: 5 }}
          paddingY={{ base: 8, md: 12 }}
        >
          {children}

          {/* What is new, as a ticker rather than a bar.
              It sits BELOW the field now. An announcement is the least
              important thing on a page whose job is to take a question, and it
              was previously the first line in the block with the only coloured
              link in it — so the eye landed on this and not on the field. */}
          {slide ? (
            <HStack gap={2.5} align="center" minHeight="20px" maxWidth="full">
              <Box flexShrink={0} color="orange.fg" display="grid">
                {slide.iconNode ?? (slide.Icon ? <slide.Icon size={14} /> : null)}
              </Box>
              <Text
                fontSize="12.5px"
                color="fg.muted"
                truncate
                display={{ base: "none", sm: "block" }}
              >
                {slide.heading}
              </Text>
              <chakra.button
                type="button"
                onClick={() => handleCta(slide)}
                fontFamily="mono"
                fontSize="11px"
                color="orange.fg"
                background="transparent"
                borderWidth={0}
                cursor="pointer"
                whiteSpace="nowrap"
                flexShrink={0}
                _hover={{ textDecoration: "underline" }}
              >
                {slide.ctaLabel}
              </chakra.button>
              {multi ? (
                <HStack gap={1} flexShrink={0}>
                  {eligible.map((_, i) => (
                    <Box
                      key={i}
                      as="button"
                      aria-label={`Show announcement ${i + 1} of ${eligible.length}`}
                      aria-current={i === active ? "true" : undefined}
                      onClick={() => selectSlide(i)}
                      width={i === active ? "16px" : "6px"}
                      height="6px"
                      borderRadius="full"
                      background={
                        i === active ? "fg.muted" : "border.emphasized"
                      }
                      transition="width 200ms ease, background 200ms ease"
                    />
                  ))}
                </HStack>
              ) : null}
              <Tooltip content={`Hide for ${SNOOZE_DAYS} days`} openDelay={400}>
                <IconButton
                  aria-label="Hide this announcement"
                  size="2xs"
                  variant="ghost"
                  color="fg.subtle"
                  flexShrink={0}
                  onClick={() => dismiss(slide)}
                >
                  <LuX size={13} />
                </IconButton>
              </Tooltip>
            </HStack>
          ) : null}
        </VStack>
      </Box>
    );
  }

  if (!slide) return null;

  if (variant === "legacy") {
    return (
      <Box
        position="relative"
        width="full"
        borderRadius="xl"
        overflow="hidden"
        color="white"
        boxShadow="0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.18)"
        minHeight={{ base: "160px", md: "172px" }}
        onMouseEnter={() => (hoveredRef.current = true)}
        onMouseLeave={() => (hoveredRef.current = false)}
        data-banner-variant="legacy"
      >
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          style={{
            background: `linear-gradient(120deg, ${colors[0] ?? "#333"}, ${
              colors[1] ?? colors[0] ?? "#333"
            } 45%, ${colors[2] ?? colors[0] ?? "#333"})`,
          }}
        />
        {!lowPerf ? (
          <Box position="absolute" inset={0} pointerEvents="none">
            <MeshGradient
              colors={colors}
              distortion={displayMesh.distortion}
              swirl={displayMesh.swirl}
              offsetX={displayMesh.offsetX}
              offsetY={displayMesh.offsetY}
              rotation={displayMesh.rotation}
              grainMixer={0.15}
              grainOverlay={0.18}
              speed={reduceMotion ? 0 : 0.45}
              scale={displayMesh.scale}
              style={{ width: "100%", height: "100%" }}
            />
          </Box>
        ) : null}
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          backgroundImage="linear-gradient(120deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0) 100%)"
        />

        <Box display="grid" position="relative" zIndex={1} width="full">
          {eligible.map((s) => {
            const isActive = s.id === slide.id;
            return (
              <motion.div
                key={s.id}
                inert={!isActive}
                initial={false}
                animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : 8 }}
                transition={slideTransition}
                style={{
                  gridArea: "1 / 1",
                  zIndex: isActive ? 1 : 0,
                  pointerEvents: isActive ? "auto" : "none",
                  willChange: "opacity, transform",
                }}
              >
                <HStack
                  align="center"
                  gap={{ base: 4, md: 6 }}
                  paddingLeft={{ base: 5, md: 7 }}
                  paddingRight={{ base: 5, md: 7 }}
                  paddingY={{ base: 5, md: 6 }}
                  width="full"
                  height="full"
                >
                  <Box
                    flexShrink={0}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    boxSize="44px"
                    borderRadius="full"
                    bg="white/20"
                    boxShadow="inset 0 0 0 1px rgba(255,255,255,0.35)"
                  >
                    {s.Icon ? (
                      <Icon as={s.Icon} boxSize={5} color="white" />
                    ) : (
                      s.iconNode
                    )}
                  </Box>

                  <VStack align="start" gap={1.5} flex={1} minWidth={0}>
                    <HStack gap={2} minWidth={0}>
                      <Heading
                        as="h2"
                        size="md"
                        fontWeight="600"
                        color="white/95"
                        letterSpacing="-0.01em"
                        lineHeight={1.25}
                      >
                        {s.heading}
                      </Heading>
                      {s.badge ? (
                        <Box
                          paddingX={2}
                          paddingY="2px"
                          borderRadius="full"
                          bg="white/30"
                          flexShrink={0}
                        >
                          <Text
                            textStyle="2xs"
                            fontWeight="700"
                            color="white"
                            letterSpacing="0.08em"
                            textTransform="uppercase"
                            lineHeight={1.2}
                          >
                            {s.badge}
                          </Text>
                        </Box>
                      ) : null}
                    </HStack>
                    <Text
                      textStyle="sm"
                      color="white/80"
                      lineHeight={1.6}
                      maxWidth={{ base: "full", md: "560px" }}
                    >
                      {s.subtitle}
                    </Text>
                    <HStack gap={2} marginTop={1.5}>
                      <Button
                        size="sm"
                        bg="white"
                        color={s.legacyCtaColor}
                        fontWeight="600"
                        paddingX={4}
                        boxShadow="0 1px 2px rgba(0,0,0,0.12)"
                        _hover={{
                          bg: "white/90",
                          transform: "translateY(-1px)",
                        }}
                        _active={{
                          bg: "white/80",
                          transform: "translateY(0)",
                        }}
                        transition="background-color 0.12s ease, transform 0.12s ease"
                        onClick={() => handleCta(s)}
                        aria-label={s.ctaLabel}
                      >
                        {s.ctaLabel}
                        <Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
                      </Button>
                    </HStack>
                  </VStack>
                </HStack>
              </motion.div>
            );
          })}
        </Box>

        {multi ? (
          <Box position="absolute" bottom={2.5} right={3} zIndex={2}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="2.5"
              />
              <g transform="rotate(-90 12 12)">
                <motion.circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ pathLength: progress }}
                />
              </g>
            </svg>
          </Box>
        ) : null}

        {multi ? (
          <HStack
            gap={2}
            justify="center"
            position="absolute"
            bottom={3}
            left={0}
            right={0}
            zIndex={2}
          >
            {eligible.map((s, i) => (
              <Box
                as="button"
                key={s.id}
                aria-label={`Show announcement ${i + 1} of ${eligible.length}`}
                onClick={() => setIndex(i)}
                width={i === active ? "18px" : "7px"}
                height="7px"
                borderRadius="full"
                bg={i === active ? "white" : "whiteAlpha.500"}
                transition="width 0.2s ease, background-color 0.2s ease"
                cursor="pointer"
                _hover={{
                  bg: i === active ? "white" : "whiteAlpha.700",
                }}
              />
            ))}
          </HStack>
        ) : null}

        <Tooltip
          content={`Hide for ${SNOOZE_DAYS} days`}
          positioning={{ placement: "top" }}
        >
          <IconButton
            size="sm"
            variant="ghost"
            color="white/80"
            position="absolute"
            top={2}
            right={2}
            zIndex={2}
            _hover={{ bg: "white/20", color: "white" }}
            _active={{ bg: "white/30" }}
            onClick={() => dismiss(slide)}
            aria-label="Dismiss"
          >
            <LuX />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box position="relative" width="full" isolation="isolate">
      <Box
        position="relative"
        width="full"
        // One card among the page's cards: the app surface, the hairline, the
        // shared 14px radius. The announcement's colour lives in the icon tile
        // and a whisper of mesh under the copy — never a billboard — so the
        // briefing stays the loudest thing on the home.
        borderRadius="14px"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.surface"
        overflow="hidden"
        onMouseEnter={() => (hoveredRef.current = true)}
        onMouseLeave={() => (hoveredRef.current = false)}
      >
        {/* Liquid-glass edges: the slide's colour "refracting" off all four
            borders — four inset glows, one per edge, that follow every
            palette morph. Colour at the rim, calm in the middle. */}
        <Box
          aria-hidden
          position="absolute"
          inset={0}
          borderRadius="inherit"
          pointerEvents="none"
          zIndex={2}
          opacity={0.45}
          style={{
            boxShadow: [
              `inset 0 10px 18px -14px ${colors[0] ?? "#333"}`,
              `inset 0 -10px 18px -14px ${colors[2] ?? colors[0] ?? "#333"}`,
              `inset 10px 0 18px -14px ${colors[1] ?? colors[0] ?? "#333"}`,
              `inset -10px 0 18px -14px ${colors[1] ?? colors[0] ?? "#333"}`,
            ].join(", "),
          }}
        />
        {/* The mesh, back inside the card as a subtle wash: the one shared
            canvas, still morphing palette + shape between slides, dialled to
            whisper opacity under the copy. */}
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          opacity={{ base: 0.09, _dark: 0.14 }}
        >
          {/* Static gradient base: the cheap fallback shown alone under a
              struggling GPU, and a colour bed behind the shader otherwise. */}
          <Box
            position="absolute"
            inset={0}
            style={{
              background: `linear-gradient(120deg, ${colors[0] ?? "#333"}, ${
                colors[1] ?? colors[0] ?? "#333"
              } 45%, ${colors[2] ?? colors[0] ?? "#333"})`,
            }}
          />
          {!lowPerf ? (
            <Box position="absolute" inset={0}>
              <MeshGradient
                colors={colors}
                distortion={displayMesh.distortion}
                swirl={displayMesh.swirl}
                offsetX={displayMesh.offsetX}
                offsetY={displayMesh.offsetY}
                rotation={displayMesh.rotation}
                grainMixer={0.12}
                grainOverlay={0.12}
                speed={reduceMotion ? 0 : (slide.speed ?? 0.45)}
                scale={displayMesh.scale}
                style={{ width: "100%", height: "100%" }}
              />
            </Box>
          ) : null}
        </Box>

        <HStack
          position="relative"
          zIndex={1}
          align="center"
          gap={{ base: 3, md: 4 }}
          paddingX={{ base: 4, md: 5 }}
          paddingTop={4}
          paddingBottom={multi ? "22px" : 4}
          width="full"
          height="full"
        >
          {/* The icon tile: the slide's palette as a plain gradient (it still
              follows the morph — `colors` interpolates every frame). */}
          <Box
            position="relative"
            flexShrink={0}
            boxSize="44px"
            borderRadius="11px"
            overflow="hidden"
            boxShadow="inset 0 0 0 1px rgba(255,255,255,0.14)"
          >
            <Box
              position="absolute"
              inset={0}
              pointerEvents="none"
              style={{
                background: `linear-gradient(120deg, ${colors[0] ?? "#333"}, ${
                  colors[1] ?? colors[0] ?? "#333"
                } 45%, ${colors[2] ?? colors[0] ?? "#333"})`,
              }}
            />
            {/* Per-slide glyph, crossfading on the morph's clock. */}
            <Box display="grid" position="relative" width="full" height="full">
              {eligible.map((s) => (
                <motion.div
                  key={s.id}
                  initial={false}
                  animate={{ opacity: s.id === slide.id ? 1 : 0 }}
                  transition={slideTransition}
                  style={{
                    gridArea: "1 / 1",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {s.iconNode ??
                    (s.Icon ? (
                      <Icon as={s.Icon} boxSize={5} color="white" />
                    ) : null)}
                </motion.div>
              ))}
            </Box>
          </Box>

          {/* Every eligible slide's copy is stacked in one grid cell, so the
              card is always the tallest slide's height and never resizes
              mid-change. Only the active slide is visible; a change fades the
              copy with a small lift on the same clock as the tile morph. */}
          <Box display="grid" flex={1} minWidth={0}>
            {eligible.map((s) => {
              const isActive = s.id === slide.id;
              return (
                <motion.div
                  key={s.id}
                  inert={!isActive}
                  initial={false}
                  animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : 6 }}
                  transition={slideTransition}
                  style={{
                    gridArea: "1 / 1",
                    zIndex: isActive ? 1 : 0,
                    pointerEvents: isActive ? "auto" : "none",
                    willChange: "opacity, transform",
                  }}
                >
                  <VStack align="start" gap={1} width="full" minWidth={0}>
                    <HStack gap={2} minWidth={0}>
                      <Heading
                        as="h2"
                        // The announcement speaks in the page's serif display
                        // voice, so it reads as the same publication as the
                        // briefing above it.
                        fontFamily={SERIF}
                        fontWeight="500"
                        fontSize="15px"
                        letterSpacing="-0.01em"
                        lineHeight={1.3}
                        color="fg"
                      >
                        {s.heading}
                      </Heading>
                      {s.badge ? (
                        <Box
                          paddingX="7px"
                          borderRadius="full"
                          borderWidth="1px"
                          borderColor="orange.emphasized"
                          flexShrink={0}
                        >
                          <Text
                            fontFamily="mono"
                            fontSize="9.5px"
                            fontWeight="600"
                            color="orange.fg"
                            letterSpacing="0.08em"
                            textTransform="uppercase"
                            lineHeight={1.6}
                          >
                            {s.badge}
                          </Text>
                        </Box>
                      ) : null}
                    </HStack>
                    <Text fontSize="12.5px" color="fg.muted" lineHeight={1.5}>
                      {s.subtitle}
                    </Text>
                    {s.extra ? (
                      <Box width="full" minWidth={0}>
                        {s.extra}
                      </Box>
                    ) : null}
                    <chakra.button
                      type="button"
                      onClick={() => handleCta(s)}
                      aria-label={s.ctaLabel}
                      flexShrink={0}
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      marginTop={1.5}
                      fontFamily="mono"
                      fontSize="11.5px"
                      whiteSpace="nowrap"
                      cursor="pointer"
                      // Wears the same orange as the "New" pill beside the
                      // heading so the call to action reads as the announcement's
                      // own colour, not a muted default. A filled subtle pill (vs
                      // the badge's outline) keeps it clearly a button.
                      color="orange.fg"
                      borderWidth="1px"
                      borderColor="orange.emphasized"
                      borderRadius="8px"
                      paddingX={2.5}
                      paddingY="4px"
                      background="orange.subtle"
                      transition="background-color 130ms ease, border-color 130ms ease"
                      _hover={{
                        background: "orange.muted",
                        borderColor: "orange.solid",
                      }}
                    >
                      {s.ctaLabel}
                      {s.showCtaKbd ? (
                        <Kbd fontSize="0.6875rem">
                          {getIsMac() ? "⌘I" : "Ctrl+I"}
                        </Kbd>
                      ) : (
                        <Icon as={LuArrowRight} boxSize={3.5} />
                      )}
                    </chakra.button>
                  </VStack>
                </motion.div>
              );
            })}
          </Box>

          {/* Dismiss — quiet inline chrome, like every other card control.
              Pinned to the TOP of the row (the row centres its items, which
              otherwise floats the X to the vertical middle) so it reads as a
              normal top-right card close. */}
          <Tooltip
            content={`Hide for ${SNOOZE_DAYS} days`}
            positioning={{ placement: "top" }}
          >
            <IconButton
              size="xs"
              variant="ghost"
              color="fg.subtle"
              flexShrink={0}
              alignSelf="flex-start"
              _hover={{ bg: "bg.muted", color: "fg" }}
              onClick={() => dismiss(slide)}
              aria-label="Dismiss"
            >
              <LuX />
            </IconButton>
          </Tooltip>
        </HStack>

        {/* Countdown ring — sweeps to full over the dwell, and eases to a stop
            on hover so it never advances under the pointer. */}
        {multi ? (
          <Box position="absolute" bottom={2} right={2.5} zIndex={2}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="var(--chakra-colors-border-emphasized)"
                strokeWidth="2.5"
              />
              <g transform="rotate(-90 12 12)">
                <motion.circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="var(--chakra-colors-fg-muted)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ pathLength: progress }}
                />
              </g>
            </svg>
          </Box>
        ) : null}

        {/* Progress and navigation: the line shows dwell time; the dots and
            arrows make the carousel explicit and usable without waiting. */}
        {multi ? (
          <HStack
            gap={1}
            justify="center"
            position="absolute"
            bottom="0px"
            left={0}
            right={0}
            zIndex={2}
          >
            <IconButton
              size="2xs"
              variant="ghost"
              aria-label="Previous announcement"
              onClick={() => selectSlide(active - 1)}
            >
              <LuArrowLeft />
            </IconButton>
            <HStack gap={0}>
              {eligible.map((s, i) => (
                <Box
                  as="button"
                  key={s.id}
                  aria-label={`Show announcement ${i + 1} of ${eligible.length}`}
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => selectSlide(i)}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  paddingX="6px"
                  paddingY="8px"
                  cursor="pointer"
                  css={{
                    "&:hover .banner-dot": {
                      background: "var(--chakra-colors-fg-muted)",
                    },
                  }}
                >
                  <Box
                    className="banner-dot"
                    width={i === active ? "16px" : "6px"}
                    height="6px"
                    borderRadius="full"
                    background={i === active ? "fg.muted" : "border.emphasized"}
                    transition="width 0.2s ease, background-color 0.2s ease"
                  />
                </Box>
              ))}
            </HStack>
            <IconButton
              size="2xs"
              variant="ghost"
              aria-label="Next announcement"
              onClick={() => selectSlide(active + 1)}
            >
              <LuArrowRight />
            </IconButton>
          </HStack>
        ) : null}
        {multi ? (
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            height="2px"
            background="border.muted"
            zIndex={1}
            pointerEvents="none"
          >
            <motion.div
              style={{
                height: "100%",
                background: "var(--chakra-colors-fg-muted)",
                scaleX: progress,
                transformOrigin: "left",
              }}
            />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
