import { HStack, Icon, Text } from "@chakra-ui/react";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { LuArrowRight, LuSparkles } from "react-icons/lu";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import {
  clearLegacySimulationsPreference,
  useLegacySimulationsPreference,
} from "~/hooks/useLegacySimulationsPreference";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { Link } from "../ui/link";
import { clearNewSimulationsCalloutSnooze } from "./NewSimulationsCallout";

/**
 * The way back to the new simulations screens, on the previous ones.
 *
 * A person who clicked "go back" on the welcome callout recorded a
 * per-browser preference for the previous screens
 * ({@link useLegacySimulationsPreference}), and without this banner that
 * choice had no way back. It shows only on that browser, only while the
 * Agent Testing release flag is on for the project, and a click clears the
 * preference and the welcome callout's dismissal, so the offer to return
 * works again in both directions.
 *
 * @see specs/suites/new-simulations-callout.feature
 */
export function ReturnToNewSimulationsBanner({
  target,
}: {
  /** Which new screen the banner leads to. */
  target: "scenarios" | "runs";
}) {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const legacyPreferred = useLegacySimulationsPreference(project?.id);

  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Only the browser that chose the previous screens needs the way back.
  // The flag read lives in the inner component, so a browser with no
  // recorded preference never queries it.
  if (!hasMounted || !project?.id || !project.slug || !legacyPreferred)
    return null;

  return (
    <BannerWithFlag
      target={target}
      projectId={project.id}
      projectSlug={project.slug}
      organizationId={organization?.id ?? ""}
    />
  );
}

function BannerWithFlag({
  target,
  projectId,
  projectSlug,
  organizationId,
}: {
  target: "scenarios" | "runs";
  projectId: string;
  projectSlug: string;
  organizationId: string;
}) {
  // Only while the project reads the new screens is there somewhere to go.
  const { enabled } = useFeatureFlag("release_ui_agent_testing_v2_enabled", {
    projectId,
    organizationId: organizationId || NOT_TARGETED,
    enabled: !!organizationId,
  });

  if (!enabled) return null;

  const href =
    target === "scenarios"
      ? `/${projectSlug}/agent-testing`
      : `/${projectSlug}/agent-testing/results`;

  const handleClick = () => {
    posthog.capture("new_simulations_banner_return_click", {
      surface: target === "scenarios" ? "scenario_library" : "simulations",
      projectId,
    });
    clearLegacySimulationsPreference(projectId);
    clearNewSimulationsCalloutSnooze(projectId);
  };

  return (
    // Content-sized: the banner sits inside the page header row beside the
    // header's own controls, so it takes only the room its words need.
    <Link
      href={href}
      onClick={handleClick}
      aria-label="Go to the new simulations screen"
      textDecoration="none"
      _hover={{ textDecoration: "none" }}
    >
      <HStack
        colorPalette="teal"
        gap={2}
        borderRadius="lg"
        paddingX={3}
        paddingY={1.5}
        whiteSpace="nowrap"
        bg="colorPalette.subtle"
        borderWidth="1px"
        borderColor="colorPalette.muted"
        transition="border-color 0.12s ease, background 0.12s ease"
        _hover={{
          borderColor: "colorPalette.emphasized",
          bg: "colorPalette.muted",
        }}
      >
        <Icon as={LuSparkles} boxSize={3.5} color="colorPalette.fg" />
        <Text fontSize="sm" color="colorPalette.fg">
          You are on the previous simulations screens.
        </Text>
        <HStack gap={1} color="colorPalette.fg" fontSize="sm" fontWeight="600">
          <Text>Go to the new version</Text>
          <Icon as={LuArrowRight} boxSize={3.5} />
        </HStack>
      </HStack>
    </Link>
  );
}
