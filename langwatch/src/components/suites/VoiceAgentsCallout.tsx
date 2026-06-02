import { Box, HStack, Icon, IconButton, Text, VStack } from "@chakra-ui/react";
import posthog from "posthog-js";
import type React from "react";
import { useEffect, useState } from "react";
import { LuArrowRight, LuMic, LuX } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Small announcement card pinned to the bottom of the simulations sidebar,
 * just above the collapse-toggle footer. Mirrors the in-app traces-v2
 * "Try the new Trace Explorer" callout pattern (gradient pill + arrow CTA +
 * snooze-on-dismiss) at a sidebar-friendly size.
 *
 * The CTA opens the public Voice docs (Scenario `voice/getting-started`)
 * in a new tab, so we render a plain `<a>` rather than the in-app `<Link>`
 * (which resolves project-scoped paths).
 *
 * Snoozes for {@link SNOOZE_DAYS} days per project; the snooze key includes
 * a `:v1:` version segment so we can recycle the card for a future
 * announcement by bumping the version without resurrecting old dismissals.
 */
const SNOOZE_DAYS = 14;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "langwatch:simulations-voice-callout-dismissed:v1:";
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
    localStorage.setItem(storageKey(projectId), String(Date.now() + SNOOZE_MS));
  } catch {
    // Best-effort dismissal.
  }
}

export function VoiceAgentsCallout() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectId = project?.id;

  const [hasMounted, setHasMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (projectId) setDismissed(isSnoozed(projectId));
  }, [projectId]);

  if (!hasMounted || !projectId || dismissed) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (projectId) snooze(projectId);
    setDismissed(true);
  };

  const handleClick = () => {
    posthog.capture("voice_agents_callout_click", {
      surface: "simulations_sidebar",
      projectId,
    });
    if (projectId) snooze(projectId);
  };

  return (
    <Box paddingX={3} paddingTop={2} paddingBottom={1}>
      <a
        href={TARGET_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        aria-label="Open Voice Agents getting started guide in a new tab"
        style={{ textDecoration: "none", display: "block" }}
      >
        <Box
          position="relative"
          borderRadius="lg"
          padding={3}
          color="white"
          overflow="hidden"
          backgroundImage="linear-gradient(135deg, #0f766e 0%, #06b6d4 55%, #6366f1 100%)"
          boxShadow="0 1px 2px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.12)"
          transition="transform 0.12s ease, box-shadow 0.12s ease"
          _hover={{
            transform: "translateY(-1px)",
            boxShadow:
              "0 2px 4px rgba(0,0,0,0.10), 0 8px 18px rgba(0,0,0,0.18)",
          }}
        >
          <HStack align="start" gap={2.5}>
            <Box
              flexShrink={0}
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxSize="26px"
              borderRadius="full"
              bg="white/25"
              boxShadow="inset 0 0 0 1px rgba(255,255,255,0.35)"
            >
              <Icon as={LuMic} boxSize={3.5} color="white" />
            </Box>
            <VStack align="start" gap={1} flex={1} minWidth={0}>
              <Text
                fontSize="xs"
                fontWeight="700"
                color="white"
                lineHeight={1.25}
                letterSpacing="-0.005em"
              >
                Try voice agent simulations
              </Text>
              <Text
                fontSize="xs"
                color="white/85"
                lineHeight={1.4}
              >
                Test your voice agent end-to-end with real voices and judge
                criteria you write in plain English.
              </Text>
              <HStack
                gap={1}
                marginTop={0.5}
                color="white"
                fontSize="xs"
                fontWeight="600"
              >
                <Text>Get started</Text>
                <Icon as={LuArrowRight} boxSize={3} />
              </HStack>
            </VStack>
          </HStack>
          <IconButton
            aria-label="Dismiss"
            size="xs"
            variant="ghost"
            color="white/80"
            position="absolute"
            top={1}
            right={1}
            minWidth="20px"
            height="20px"
            padding={0}
            _hover={{ bg: "white/20", color: "white" }}
            _active={{ bg: "white/30" }}
            onClick={handleDismiss}
          >
            <LuX size={12} />
          </IconButton>
        </Box>
      </a>
    </Box>
  );
}
