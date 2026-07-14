import { Box, Button, Heading, HStack, Icon, IconButton, Text, VStack } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { motion, useAnimationFrame, useMotionValue } from "motion/react";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import { LuArrowRight, LuMic, LuX, LuZap } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useRouter } from "~/utils/compat/next-router";
import { useColorModeValue } from "../ui/color-mode";
import { Tooltip } from "../ui/tooltip";

// ---- Timing knobs -------------------------------------------------------

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
	Icon: IconType;
	heading: string;
	badge: string;
	subtitle: React.ReactNode;
	ctaLabel: string;
	/** Text colour of the CTA on its white pill. */
	ctaColor: string;
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
		ctaColor: "orange.700",
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
				Test your voice agent end-to-end with real voices, real audio, and judge
				criteria you write in plain English.
				<br />
				Works with ElevenLabs, OpenAI Realtime, Gemini Live, Vapi, LiveKit,
				Pipecat, and more.
			</>
		),
		ctaLabel: "Try voice agent testing",
		ctaColor: "teal.700",
		posthogEvent: "voice_agents_banner_click",
		navigate: () =>
			window.open(
				"https://langwatch.ai/scenario/voice/getting-started",
				"_blank",
				"noopener,noreferrer",
			),
	},
];

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
	return rgbToHex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
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
export function HomePageBanners() {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;
	const projectSlug = project?.slug;
	const router = useRouter();
	const reduceMotion = useReducedMotion();
	const isDark = useColorModeValue(false, true);

	const [hasMounted, setHasMounted] = useState(false);
	const [snoozed, setSnoozed] = useState<Record<string, boolean>>({});
	const [index, setIndex] = useState(0);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	useEffect(() => {
		if (!projectId) return;
		const next: Record<string, boolean> = {};
		for (const slide of SLIDES) next[slide.id] = isSlideSnoozed(slide, projectId);
		setSnoozed(next);
	}, [projectId]);

	const eligible = useMemo(
		() => SLIDES.filter((slide) => !snoozed[slide.id]),
		[snoozed],
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
	const morphRef = useRef<{ from: string[]; fromMesh: Mesh; start: number | null } | null>(null);
	const perfRef = useRef<{ start: number | null; frames: number; done: boolean }>({
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
		speedRef.current += (targetSpeed - speedRef.current) * (1 - Math.exp(-dt / HOVER_TAU));

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

	if (!hasMounted || eligible.length === 0 || !slide) return null;

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
		if (projectId) snoozeSlide(slideToOpen, projectId);
		setSnoozed((s) => ({ ...s, [slideToOpen.id]: true }));
		setIndex(0);
		slideToOpen.navigate({ router, projectSlug });
	};

	const colors = displayColors.length ? displayColors : targetColors;
	const multi = eligible.length > 1;
	// Enter and exit run at once (AnimatePresence popLayout) so the two lots of
	// copy dissolve THROUGH each other, sharing the gradient morph's duration and
	// easing so the whole change lands as one motion. Instant when snapping for
	// reduced motion / weak GPU.
	const slideTransition = instant
		? { duration: 0 }
		: { duration: TRANSITION_S, ease: TRANSITION_EASE };

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
		>
			{/* Static CSS gradient base: the cheap fallback shown alone under a
			    struggling GPU, and a colour bed behind the shader otherwise. */}
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

			{/* Every eligible slide is stacked in one grid cell, so the banner is
			    always the tallest slide's height and never resizes mid-change.
			    Only the active slide is visible; a change fades the copy with a
			    small lift, on the same clock as the gradient morph, so copy and
			    colour settle together. */}
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
									<Icon as={s.Icon} boxSize={5} color="white" />
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
											color={s.ctaColor}
											fontWeight="600"
											paddingX={4}
											boxShadow="0 1px 2px rgba(0,0,0,0.12)"
											_hover={{ bg: "white/90", transform: "translateY(-1px)" }}
											_active={{ bg: "white/80", transform: "translateY(0)" }}
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

			{/* Countdown ring — sweeps to full over the dwell, and eases to a stop
			    on hover so it never advances under the pointer. */}
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

			{/* Position dots — jump straight to a slide. */}
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
							_hover={{ bg: i === active ? "white" : "whiteAlpha.700" }}
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
