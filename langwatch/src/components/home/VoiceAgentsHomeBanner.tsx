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
import { LuArrowRight, LuMic, LuX } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useColorModeValue } from "../ui/color-mode";
import { Tooltip } from "../ui/tooltip";

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX =
	"langwatch:voice-agents-home-banner-dismissed:v1:";
const TARGET_URL = "https://langwatch.ai/scenario/voice/getting-started";

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

// Teal → cyan → indigo palette, so this banner visually rhymes with
// `TracesV2HomeBanner` (same MeshGradient + glass-card shape) without looking
// like a duplicate when the home page rotates between the two announcements.
const MESH_COLORS_LIGHT = ["#0f766e", "#06b6d4", "#6366f1", "#ecfeff"];
const MESH_COLORS_DARK = ["#134e4a", "#0e7490", "#312e81", "#0a1424"];

export function VoiceAgentsHomeBanner() {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;
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

	if (!hasMounted || !projectId || dismissed) {
		return null;
	}

	const handleDismiss = () => {
		if (projectId) snooze(projectId);
		setDismissed(true);
	};

	const handleClick = () => {
		posthog.capture("voice_agents_banner_click", {
			surface: "home_banner",
			projectId,
		});
		if (projectId) snooze(projectId);
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
					<Icon as={LuMic} boxSize={5} color="white" />
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
							Voice agent simulations are here
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
								New
							</Text>
						</Box>
					</HStack>
					<Text
						textStyle="sm"
						color="white/90"
						lineHeight={1.5}
						maxWidth={{ base: "full", md: "520px" }}
					>
						Test your voice agent end-to-end with real voices, real audio, and judge criteria you write in plain English. Works with ElevenLabs, OpenAI Realtime, Gemini Live, Vapi, LiveKit, Pipecat, and more.
					</Text>
					<HStack gap={2} marginTop={1.5}>
						{/*
						 * Plain <a> + target=_blank — this points to the public docs
						 * site, not an internal route, so the in-app `<Link>` (which
						 * resolves project-scoped paths) is the wrong primitive.
						 */}
						<a
							href={TARGET_URL}
							target="_blank"
							rel="noopener noreferrer"
							onClick={handleClick}
							aria-label="Open Voice Agents getting started guide in a new tab"
							style={{ textDecoration: "none" }}
						>
							<Button
								size="sm"
								bg="white"
								color="teal.700"
								fontWeight="600"
								paddingX={4}
								boxShadow="0 1px 2px rgba(0,0,0,0.12)"
								_hover={{ bg: "white/90", transform: "translateY(-1px)" }}
								_active={{ bg: "white/80", transform: "translateY(0)" }}
								transition="background-color 0.12s ease, transform 0.12s ease"
							>
								Try voice agent testing
								<Icon as={LuArrowRight} boxSize={3.5} marginLeft={1} />
							</Button>
						</a>
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

/**
 * Helper for callers that want to gate the voice banner on the prior
 * traces-v2 banner being dismissed/snoozed already. Exposed so the
 * `HomePage` orchestrator can pick one banner at a time without leaking
 * storage-key knowledge.
 */
export function isVoiceAgentsBannerSnoozed(projectId: string): boolean {
	return isSnoozed(projectId);
}
