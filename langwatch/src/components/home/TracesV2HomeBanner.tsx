import {
	Box,
	Button,
	Heading,
	HStack,
	Icon,
	IconButton,
	Text,
	VStack,
} from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { LuArrowRight, LuSparkles, LuX } from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { setTracesV2Preferred } from "~/features/traces-v2/hooks/useTracesV2Preference";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useColorModeValue } from "../ui/color-mode";

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "langwatch:tracesV2-home-banner-dismissed:v2:try:";

const storageKey = (projectId: string) => `${STORAGE_PREFIX}${projectId}`;

function isSnoozed(projectId: string): boolean {
	if (typeof window === "undefined") return false;
	try {
		const raw = localStorage.getItem(storageKey(projectId));
		if (!raw) return false;
		const expiresAt = Number(raw);
		if (!Number.isFinite(expiresAt)) return false;
		return expiresAt > Date.now();
	} catch {
		return false;
	}
}

function snooze(projectId: string) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(
			storageKey(projectId),
			String(Date.now() + SNOOZE_MS),
		);
	} catch {
		// Best-effort dismissal.
	}
}

/**
 * Exposed so the home page can decide whether to show this banner or fall
 * back to the next-in-line announcement (e.g. {@link VoiceAgentsHomeBanner}).
 */
export function isTracesV2BannerSnoozed(projectId: string): boolean {
	return isSnoozed(projectId);
}

// Colours mirror the in-app NewTracesPromo banner so the two surfaces feel
// like the same announcement. Resolved hex values are required because the
// MeshGradient WebGL shader cannot read CSS variables.
const MESH_COLORS_LIGHT = ["#6b21a8", "#a855f7", "#ec4899", "#fdf2f8"];
const MESH_COLORS_DARK = ["#581c87", "#9333ea", "#db2777", "#1f0a2e"];

/**
 * @param onDismissed Fired when the user dismisses (or click-through-snoozes)
 *   the banner. The parent ({@link HomePageBanners}) uses this to flip to the
 *   next banner in the same render pass instead of waiting for a reload.
 */
export function TracesV2HomeBanner({
	onDismissed,
}: { onDismissed?: () => void } = {}) {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;
	const projectSlug = project?.slug;
	const reduceMotion = useReducedMotion();
	const meshColors = useColorModeValue(MESH_COLORS_LIGHT, MESH_COLORS_DARK);

	const [dismissed, setDismissed] = useState(false);
	const [hasMounted, setHasMounted] = useState(false);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	useEffect(() => {
		if (projectId) setDismissed(isSnoozed(projectId));
	}, [projectId]);

	if (!hasMounted || !projectSlug || dismissed) {
		return null;
	}

	const handleDismiss = () => {
		if (projectId) snooze(projectId);
		setDismissed(true);
		onDismissed?.();
	};

	// Flip the per-device preference so `useTraceDetailsDrawer` opens
	// the v2 drawer everywhere else in the app after the user clicks
	// through the home banner — without this, opening a trace from the
	// messages table would still land on v1 even though they just opted
	// in here.
	const handleTryV2 = () => {
		setTracesV2Preferred(true);
		posthog.capture("traces_v2_opt_in", {
			surface: "home_banner",
			projectId,
		});
		if (projectId) snooze(projectId);
	};

	const v2Href = `/${projectSlug}/traces`;

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
				paddingRight={{ base: 5, md: 7 }}
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
							The new Trace Explorer is here
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
								Beta
							</Text>
						</Box>
					</HStack>
					<Text
						textStyle="sm"
						color="white/90"
						lineHeight={1.5}
						maxWidth={{ base: "full", md: "520px" }}
					>
						A faster, friendlier tracing experience, built on everything we learned from v1. Take it for a spin and tell us what you think.
					</Text>
					<HStack gap={2} marginTop={1.5}>
						<Link
							href={v2Href}
							onClick={handleTryV2}
							aria-label="Open new Trace Explorer"
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
								Try the new Trace Explorer
								<Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
							</Button>
						</Link>
					</HStack>
				</VStack>
			</HStack>

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
