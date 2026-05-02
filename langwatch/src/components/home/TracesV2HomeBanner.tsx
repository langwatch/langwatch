import {
  Box,
  Button,
  chakra,
  Heading,
  HStack,
  Icon,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";
import { LuArrowRight, LuMessageCircle, LuSparkles, LuX } from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useColorModeValue } from "../ui/color-mode";

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "langwatch:tracesV2-home-banner-dismissed:v2:";

type PromoMode = "try" | "request";

const storageKey = (projectId: string, mode: PromoMode) =>
	`${STORAGE_PREFIX}${mode}:${projectId}`;

function isSnoozed(projectId: string, mode: PromoMode): boolean {
	if (typeof window === "undefined") return false;
	try {
		const raw = localStorage.getItem(storageKey(projectId, mode));
		if (!raw) return false;
		const expiresAt = Number(raw);
		if (!Number.isFinite(expiresAt)) return false;
		return expiresAt > Date.now();
	} catch {
		return false;
	}
}

function snooze(projectId: string, mode: PromoMode) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(
			storageKey(projectId, mode),
			String(Date.now() + SNOOZE_MS),
		);
	} catch {
		// Best-effort dismissal.
	}
}

function openCrispChat(): boolean {
	if (typeof window === "undefined") return false;
	const crisp = (
		window as unknown as { $crisp?: { push: (args: unknown[]) => void } }
	).$crisp;
	if (!crisp) return false;
	crisp.push(["do", "chat:show"]);
	crisp.push(["do", "chat:toggle"]);
	return true;
}

// Colours mirror the in-app NewTracesPromo banner so the two surfaces feel
// like the same announcement. Resolved hex values are required because the
// MeshGradient WebGL shader cannot read CSS variables.
const MESH_COLORS_LIGHT = ["#6b21a8", "#a855f7", "#ec4899", "#fdf2f8"];
const MESH_COLORS_DARK = ["#581c87", "#9333ea", "#db2777", "#1f0a2e"];

const PREVIEW_VARIANTS = ["simple", "complex"] as const;
const PREVIEW_THEMES = ["light", "dark"] as const;
type PreviewVariant = (typeof PREVIEW_VARIANTS)[number];
type PreviewTheme = (typeof PREVIEW_THEMES)[number];

// How long each variant stays on screen before the cross-fade.
const PREVIEW_CYCLE_MS = 6000;
const PREVIEW_FADE_MS = 700;

interface PreviewFrameProps {
	href: string;
	onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
	ariaLabel: string;
	children: React.ReactNode;
}

/**
 * Request-mode-only preview. Default state: small peek in the bottom-right
 * corner. On hover the screenshot scales up with a `top right` transform
 * origin and translates *up* — the top of the screenshot stays comfortably
 * inside the banner (no clipping at the banner's top edge), and the extra
 * height grows downward where it gets clipped by the banner's overflow.
 * Net effect: the user sees a much larger, clearer view of the toolbar /
 * trace list (the "top" of the product) without the preview spilling
 * awkwardly above the banner.
 */
function PreviewFrame({
	href,
	onClick,
	ariaLabel,
	children,
}: PreviewFrameProps) {
	const hoverTransform = "translateY(5%) scale(1.85)";

	return (
		<Link
			href={href}
			onClick={onClick}
			aria-label={ariaLabel}
			style={{ display: "contents" }}
		>
			<Box
				position="absolute"
				right={{ base: 4, md: 8 }}
				bottom={0}
				width={{ base: "210px", md: "270px" }}
				height={{ base: "123px", md: "158px" }}
				display={{ base: "none", sm: "block" }}
				zIndex={1}
				cursor="pointer"
				transformOrigin="top right"
				transform="translateY(38%)"
				transition="transform 380ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 280ms ease"
				_hover={{
					transform: hoverTransform,
					filter: "brightness(1.05)",
					zIndex: 5,
				}}
				_focusVisible={{
					transform: hoverTransform,
					zIndex: 5,
					outline: "2px solid white",
					outlineOffset: "4px",
					borderRadius: "lg",
				}}
			>
				{children}
			</Box>
		</Link>
	);
}

export function TracesV2HomeBanner() {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;
	const projectSlug = project?.slug;
	const reduceMotion = useReducedMotion();
	const meshColors = useColorModeValue(MESH_COLORS_LIGHT, MESH_COLORS_DARK);
	const previewTheme: PreviewTheme = useColorModeValue("light", "dark");
	const [previewVariant, setPreviewVariant] =
		useState<PreviewVariant>("simple");

	useEffect(() => {
		if (reduceMotion) return;
		const id = setInterval(() => {
			setPreviewVariant((v) => (v === "simple" ? "complex" : "simple"));
		}, PREVIEW_CYCLE_MS);
		return () => clearInterval(id);
	}, [reduceMotion]);

	const { enabled: tracesV2Enabled, isLoading: tracesV2FlagLoading } =
		useFeatureFlag("release_ui_traces_v2_enabled", {
			projectId,
			enabled: !!projectId,
		});
	const mode: PromoMode = tracesV2Enabled ? "try" : "request";

	const [dismissed, setDismissed] = useState(false);
	const [hasMounted, setHasMounted] = useState(false);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	useEffect(() => {
		if (projectId) setDismissed(isSnoozed(projectId, mode));
	}, [projectId, mode]);

	if (!hasMounted || !projectSlug || tracesV2FlagLoading || dismissed) {
		return null;
	}

	const handleDismiss = () => {
		if (projectId) snooze(projectId, mode);
		setDismissed(true);
	};

	const v2Href = `/${projectSlug}/traces`;

	const requestAccessMailto = `mailto:support@langwatch.ai?subject=${encodeURIComponent(
		"Early access to the new Trace Explorer",
	)}&body=${encodeURIComponent(
		"Hi! I'd like early access to the new Trace Explorer" +
			(project?.slug ? ` for project "${project.slug}"` : "") +
			".",
	)}`;

	const handleRequestAccess = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (openCrispChat()) {
			e.preventDefault();
		}
	};

	return (
		<Box
			position="relative"
			width="full"
			borderRadius="xl"
			overflow="hidden"
			color="white"
			boxShadow="0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.18)"
			minHeight={{ base: "160px", md: "172px" }}
		>
			<Box position="absolute" inset={0} pointerEvents="none">
				<MeshGradient
					colors={meshColors}
					distortion={0.85}
					swirl={0.6}
					grainMixer={0.15}
					grainOverlay={0.18}
					speed={reduceMotion ? 0 : 0.45}
					scale={1.2}
					style={{ width: "100%", height: "100%" }}
				/>
			</Box>
			<Box
				position="absolute"
				inset={0}
				pointerEvents="none"
				backgroundImage="linear-gradient(120deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0) 100%)"
			/>

			<HStack
				position="relative"
				zIndex={1}
				align="center"
				gap={{ base: 4, md: 6 }}
				paddingLeft={{ base: 5, md: 7 }}
				paddingRight={
					mode === "request"
						? { base: 5, sm: "230px", md: "290px" }
						: { base: 5, md: 7 }
				}
				paddingY={{ base: 5, md: 6 }}
				width="full"
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
					<Icon as={LuSparkles} boxSize={5} color="white" />
				</Box>

				<VStack align="start" gap={1.5} flex={1} minWidth={0}>
					<HStack gap={2} minWidth={0}>
						<Heading
							as="h2"
							size="md"
							color="white"
							letterSpacing="-0.01em"
							lineHeight={1.2}
						>
							{mode === "try"
								? "The new Trace Explorer is here"
								: "A new Trace Explorer is on the way"}
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
								{mode === "try" ? "Beta" : "Coming soon"}
							</Text>
						</Box>
					</HStack>
					<Text
						textStyle="sm"
						color="white/90"
						lineHeight={1.5}
						maxWidth={{ base: "full", md: "520px" }}
					>
						{mode === "try"
							? "A faster, friendlier tracing experience — built on everything we learned from v1. Take it for a spin and tell us what you think."
							: "We're rolling out a faster, friendlier tracing experience in private beta. Want in early? Get in touch and we'll switch it on for you."}
					</Text>
					<HStack gap={2} marginTop={1.5}>
						{mode === "try" ? (
							<Link href={v2Href} aria-label="Open new Trace Explorer">
								<Button
									size="sm"
									bg="white"
									color="purple.700"
									fontWeight="600"
									paddingX={4}
									boxShadow="0 1px 2px rgba(0,0,0,0.12)"
									_hover={{ bg: "white/90", transform: "translateY(-1px)" }}
									_active={{ bg: "white/80", transform: "translateY(0)" }}
									transition="background-color 0.12s ease, transform 0.12s ease"
								>
									Try the new Trace Explorer
									<Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
								</Button>
							</Link>
						) : (
							<Link
								href={requestAccessMailto}
								onClick={handleRequestAccess}
								aria-label="Request early access to the new Trace Explorer"
							>
								<Button
									size="sm"
									bg="white"
									color="purple.700"
									fontWeight="600"
									paddingX={4}
									boxShadow="0 1px 2px rgba(0,0,0,0.12)"
									_hover={{ bg: "white/90", transform: "translateY(-1px)" }}
									_active={{ bg: "white/80", transform: "translateY(0)" }}
									transition="background-color 0.12s ease, transform 0.12s ease"
								>
									<Icon as={LuMessageCircle} boxSize={3.5} marginRight={1} />
									Request early access
								</Button>
							</Link>
						)}
					</HStack>
				</VStack>
			</HStack>

			{/*
        Preview screenshot. Sits in the bottom-right corner and is pushed
        below the banner edge so only its top portion is visible — the
        SaaS "screenshot peeking up into the hero" pattern. Renders all
        four light/dark × simple/complex variants stacked and toggles
        opacity, so both the timed variant cycle and theme changes share
        the same cross-fade. The screenshots already include their own
        window chrome and drop shadow, so we don't add a frame here.
      */}
			{mode === "request" && (
				<PreviewFrame
					href={requestAccessMailto}
					onClick={handleRequestAccess}
					ariaLabel="Request early access to the new Trace Explorer"
				>
					{PREVIEW_VARIANTS.flatMap((variant) =>
						PREVIEW_THEMES.map((theme) => {
							const isActive =
								variant === previewVariant && theme === previewTheme;
							return (
								<chakra.img
									key={`${variant}-${theme}`}
									src={`/images/traces-v2/traces-v2-${variant}.${theme}.webp`}
									alt=""
									aria-hidden="true"
									draggable={false}
									position="absolute"
									inset={0}
									width="100%"
									height="100%"
									objectFit="contain"
									objectPosition="top right"
									opacity={isActive ? 1 : 0}
									transition={`opacity ${PREVIEW_FADE_MS}ms ease`}
								/>
							);
						}),
					)}
				</PreviewFrame>
			)}

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
					onClick={handleDismiss}
					aria-label="Dismiss"
				>
					<LuX />
				</IconButton>
			</Tooltip>
		</Box>
	);
}
