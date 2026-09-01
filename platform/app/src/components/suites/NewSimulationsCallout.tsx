import { Box, HStack, Icon, IconButton, Text, VStack } from "@chakra-ui/react";
import posthog from "posthog-js";
import type React from "react";
import { useEffect, useState } from "react";
import { LuArrowRight, LuSparkles, LuX } from "react-icons/lu";
import {
  preferLegacySimulations,
  useLegacySimulationsPreference,
} from "~/hooks/useLegacySimulationsPreference";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { Link } from "../ui/link";

/**
 * Small announcement card pinned to the bottom of the Agent Testing
 * sidebars. It tells the reader they are on the new simulations screens and
 * offers the way back to the previous ones: a click records the per-browser
 * preference ({@link preferLegacySimulations}) and navigates to the previous
 * screen that matches where the card sits, `target="scenarios"` to the
 * scenario library and `target="runs"` to the runs list.
 *
 * The dismissal key is its own, so people who dismissed the earlier voice
 * announcement still see this one. Snoozes for {@link SNOOZE_DAYS} days per
 * project; the key carries a `:v1:` version segment so a future announcement
 * can recycle the card by bumping the version.
 *
 * The card retires on {@link SUNSET} and never shows after it. The
 * `?simulations-welcome=1` address parameter brings it back past the
 * dismissal, the retirement and the recorded preference, so a person who
 * wants the way back to the previous screens can still reach it.
 *
 * @see specs/suites/new-simulations-callout.feature
 */
const SNOOZE_DAYS = 14;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "langwatch:new-simulations-callout-dismissed:v1:";
/** Three weeks after the new screens shipped, the announcement retires. */
const SUNSET = Date.parse("2026-09-22T00:00:00Z");
/** The address parameter that brings the retired or dismissed card back. */
export const WELCOME_CALLOUT_QUERY_PARAM = "simulations-welcome";

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

/**
 * Forgets a dismissal, so the card shows again. The return banner on the
 * previous screens calls this: a person going back to the new screens gets
 * the way back offered again.
 */
export function clearNewSimulationsCalloutSnooze(projectId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    // Best-effort.
  }
}

export function NewSimulationsCallout({
  target,
}: {
  /** Which previous screen the card leads back to. */
  target: "scenarios" | "runs";
}) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectId = project?.id;
  const projectSlug = project?.slug;

  const [hasMounted, setHasMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Someone who already chose the previous screens does not need the offer
  // again while they browse the new ones.
  const legacyPreferred = useLegacySimulationsPreference(projectId);
  const router = useRouter();
  // The parameter is the escape hatch once the card retired: it overrides
  // the dismissal, the retirement and the recorded preference.
  const revived = router.query[WELCOME_CALLOUT_QUERY_PARAM] === "1";
  const retired = Date.now() >= SUNSET;

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (projectId) setDismissed(isSnoozed(projectId));
  }, [projectId]);

  if (!hasMounted || !projectId || !projectSlug) return null;
  if (!revived && (dismissed || legacyPreferred || retired)) return null;

  const href =
    target === "scenarios"
      ? `/${projectSlug}/simulations/scenarios`
      : `/${projectSlug}/simulations`;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    snooze(projectId);
    setDismissed(true);
  };

  const handleClick = () => {
    posthog.capture("new_simulations_callout_back_click", {
      surface:
        target === "scenarios"
          ? "agent_testing_sidebar"
          : "agent_testing_runs_sidebar",
      projectId,
    });
    preferLegacySimulations(projectId);
  };

  return (
    <Box paddingTop={2} paddingBottom={1}>
      <Link
        href={href}
        onClick={handleClick}
        aria-label="Go back to the previous simulations screen"
        textDecoration="none"
        display="block"
        _hover={{ textDecoration: "none" }}
      >
        <Box
          colorPalette="teal"
          position="relative"
          borderRadius="lg"
          padding={3}
          overflow="hidden"
          bg="colorPalette.subtle"
          borderWidth="1px"
          borderColor="colorPalette.muted"
          transition="transform 0.12s ease, border-color 0.12s ease, background 0.12s ease"
          _hover={{
            transform: "translateY(-1px)",
            borderColor: "colorPalette.emphasized",
            bg: "colorPalette.muted",
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
              bg="colorPalette.solid"
            >
              <Icon as={LuSparkles} boxSize={3.5} color="white" />
            </Box>
            <VStack align="start" gap={1} flex={1} minWidth={0}>
              <Text
                fontSize="xs"
                fontWeight="700"
                color="colorPalette.fg"
                lineHeight={1.25}
                letterSpacing="-0.005em"
                paddingRight="18px"
              >
                Welcome to the new simulations screen
              </Text>
              <Text fontSize="xs" color="fg.muted" lineHeight={1.4}>
                Prefer the previous version? Click here to go back.
              </Text>
              <HStack
                gap={1}
                marginTop={0.5}
                color="colorPalette.fg"
                fontSize="xs"
                fontWeight="600"
              >
                <Text>Go back</Text>
                <Icon as={LuArrowRight} boxSize={3} />
              </HStack>
            </VStack>
          </HStack>
          <IconButton
            aria-label="Dismiss"
            size="xs"
            variant="ghost"
            color="fg.muted"
            position="absolute"
            top={1}
            right={1}
            minWidth="20px"
            height="20px"
            padding={0}
            _hover={{ bg: "colorPalette.emphasized", color: "colorPalette.fg" }}
            _active={{ bg: "colorPalette.emphasized" }}
            onClick={handleDismiss}
          >
            <LuX size={12} />
          </IconButton>
        </Box>
      </Link>
    </Box>
  );
}
