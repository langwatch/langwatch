/**
 * IntegratePane — the default view for no-traces projects.
 *
 * Shown when `hasAnyTraces === false` and the user hasn't flipped on
 * "See sample data". A focused full-screen integration guide — same
 * step-by-step content the IntegrateDrawer hosts, rendered inline
 * here so the user lands directly on what they need to do (mint a
 * token, pick a path, copy the snippet). No table, no toolbar, no
 * sidebar, no sample-data noise — just the integration journey, with
 * a single quiet "See sample data" escape if they want to preview
 * the product first.
 */
import { Box, Button, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Compass } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  type ActiveProjectContextValue,
  ActiveProjectProvider,
} from "~/features/onboarding/contexts/ActiveProjectContext";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  IntegrationContent,
  SEGMENTS,
  type Segment,
} from "../../onboarding/components/IntegrateDrawer";
import { writeSpotlightFragment } from "../../onboarding/spotlights/SpotlightOverlay";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../../onboarding/spotlights/spotlights";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { SearchBar } from "../SearchBar/SearchBar";
import { Toolbar } from "../Toolbar/Toolbar";

export const IntegratePane: React.FC = () => {
  const setShowSamplePreview = useOnboardingStore(
    (s) => s.setShowSamplePreview,
  );
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );
  const { project, organization } = useOrganizationTeamProject();
  const [token, setToken] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("skill");

  // Imperative `inert` set on the chrome wrapper so focus skips the
  // faded SearchBar / Toolbar entirely (the JSX `inert` prop is
  // dropped silently by older React versions; the IDL property always
  // sticks). Combined with pointer-events / aria-hidden / user-select
  // below, the chrome is completely inert in every interaction model.
  const chromeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chromeRef.current;
    if (el) el.inert = true;
  }, []);

  const activeSegment =
    SEGMENTS.find((s) => s.value === segment) ?? SEGMENTS[0];

  if (!project || !organization) return null;

  const activeProjectContext: ActiveProjectContextValue = {
    project: token ? { ...project, apiKey: token } : project,
    organization,
    freshToken: token ?? undefined,
    onFreshToken: setToken,
  };

  const enterSampleMode = () => {
    setShowSamplePreview(true);
    // Mirror the toolbar's See-sample-data behaviour — opting into
    // sample data auto-starts the spotlight tour so the user gets
    // contextual callouts on the sample rows. They can dismiss from
    // any spotlight without turning samples off.
    const first = TRACE_EXPLORER_SPOTLIGHTS[0];
    const firstId = first?.id ?? null;
    setCurrentSpotlightId(firstId);
    setSpotlightsActive(true);
    writeSpotlightFragment(firstId);
  };

  return (
    <Flex
      as="main"
      role="main"
      aria-label="Integrate your code"
      direction="column"
      flex={1}
      minWidth={0}
      height="full"
      overflow="auto"
      position="relative"
      bg="bg.surface"
    >
      {/* Single soft orange glow centred on the page that breathes and
          slow-rotates. Three slightly offset radial blobs share the
          centre so the rotation is just-perceptible (a pure-centred
          circle would rotate invisibly), and the whole layer fades to
          transparent well before the page edges so there's no hard
          gradient line at the container boundary. The point is "a
          gentle pull to the middle" — the eye drifts there without
          consciously registering an animation. `prefers-reduced-motion`
          freezes the breath/rotate so the glow becomes a static wash. */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        aria-hidden="true"
        zIndex={0}
        overflow="hidden"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          width="140vmin"
          height="140vmin"
          borderRadius="full"
          opacity={0.1}
          filter="blur(80px)"
          backgroundImage={`
            radial-gradient(circle at 46% 50%, var(--chakra-colors-orange-300) 0%, transparent 36%),
            radial-gradient(circle at 54% 48%, var(--chakra-colors-orange-400) 0%, transparent 30%),
            radial-gradient(circle at 50% 54%, var(--chakra-colors-orange-200) 0%, transparent 42%)
          `}
          css={{
            animation: "lw-center-breath 96s linear infinite",
            willChange: "transform",
            "@keyframes lw-center-breath": {
              "0%": { transform: "rotate(0deg) scale(0.92)" },
              "50%": { transform: "rotate(180deg) scale(1.08)" },
              "100%": { transform: "rotate(360deg) scale(0.92)" },
            },
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
            },
          }}
        />
      </Box>
      {/* Real SearchBar + Toolbar in a non-interactive treatment so
          the user reads this as the trace page (just empty). Pointer
          events off, focus skips via `inert` (set imperatively above
          for cross-React-version safety), aria-hidden for screen
          readers, user-select none so text can't even be highlighted.
          tabIndex={-1} as a defensive belt — if `inert` is ever
          stripped by a future Chakra update, the wrapper still
          refuses focus. */}
      <Box
        ref={chromeRef}
        tabIndex={-1}
        aria-hidden="true"
        pointerEvents="none"
        opacity={0.5}
        userSelect="none"
        flexShrink={0}
        position="relative"
        zIndex={1}
      >
        <SearchBar />
        {/* `hideSampleDataAction` collapses the toolbar's "See sample
            data" toggle to invisible — the hero outlined button next
            to the page title is the canonical entry point in the
            empty-trace state. Showing it in both places splits
            attention; the larger hero one is what we want users to
            press here. */}
        <Toolbar hideSampleDataAction />
      </Box>
      {/* The empty-state hero feels best floated to the middle of the
          page when it fits — that's where the eye lands first and the
          centred orange glow is brightest. `justify-content: safe
          center` is the flex variant that centers when there's room
          and falls back to flex-start (top) when the content is taller
          than the available space, so longer-content viewports (small
          laptops, zoomed-in) still scroll the hero from the top instead
          of getting clipped above the toolbar. */}
      <Flex
        flex={1}
        direction="column"
        justify="safe center"
        align="stretch"
        minHeight={0}
        position="relative"
        zIndex={1}
      >
      <Box
        width="full"
        maxWidth="980px"
        marginX="auto"
        paddingX={8}
        paddingY={10}
      >
        <ActiveProjectProvider value={activeProjectContext}>
          <VStack align="stretch" gap={8}>
            {/* Hero with the secondary "See sample data" action lifted
                up alongside the title so it stays above the fold. The
                old "Not ready to wire up?" footer card has been removed
                — having the same escape down there meant most users
                never saw it before scrolling through the integration
                content. */}
            <HStack justify="space-between" align="flex-start" gap={4}>
              <VStack align="stretch" gap={1.5} flex={1} minWidth={0}>
                <Text textStyle="2xl" fontWeight="600" color="fg" letterSpacing="-0.015em">
                  Instrument your agents in seconds
                </Text>
                <Text textStyle="sm" color="fg.muted" lineHeight="tall">
                  Mint a token, then pick how you want to send traces. Skills
                  and MCP take under a minute; the SDK takes a couple more.
                </Text>
              </VStack>
              <Button
                size="sm"
                variant="outline"
                colorPalette="orange"
                onClick={enterSampleMode}
                flexShrink={0}
                transition="all 0.15s ease"
                _hover={{
                  bg: "orange.subtle",
                  borderColor: "orange.emphasized",
                  transform: "translateY(-1px)",
                }}
                _active={{
                  bg: "orange.muted",
                  transform: "translateY(0)",
                }}
              >
                <Icon as={Compass} boxSize={4} />
                See sample data
              </Button>
            </HStack>

            <IntegrationContent
              organizationId={organization.id}
              projectId={project.id}
              token={token}
              onTokenGenerated={setToken}
              segment={segment}
              onSegmentChange={setSegment}
              activeSegmentDescription={activeSegment?.description ?? ""}
            />
          </VStack>
        </ActiveProjectProvider>
      </Box>
      </Flex>
    </Flex>
  );
};

