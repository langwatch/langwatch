/**
 * IntegratePane — the default view for no-traces projects.
 *
 * Shown when `hasAnyTraces === false` and the user hasn't flipped on
 * "See sample data". The page mints an access token first, then offers
 * the ways forward under it: hand the setup to an agent, read the SDK
 * instructions, or look at sample data before writing any code. One
 * thing to read at a time, in the order the reader does them.
 *
 * Spec: specs/traces-v2/integrate-pane.feature
 */
import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Code2, Compass } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { SetupWithAgentButton } from "~/components/SetupWithAgentButton";
import {
  type ActiveProjectContextValue,
  ActiveProjectProvider,
} from "~/features/onboarding/contexts/ActiveProjectContext";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { ApiKeyIntegrationInfoCard } from "../../onboarding/components/ApiKeyIntegrationInfoCard";
import { SdkSetup } from "../../onboarding/components/SdkSetup";
import { selfHostedEndpoint } from "../../onboarding/logic/selfHostedEndpoint";
import { writeSpotlightFragment } from "../../onboarding/spotlights/SpotlightOverlay";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../../onboarding/spotlights/spotlights";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { SearchBar } from "../SearchBar/SearchBar";
import { Toolbar } from "../Toolbar/Toolbar";
import { IntegratePaneShell } from "./IntegratePaneShell";

export const IntegratePane: React.FC = () => {
  const setShowSamplePreview = useOnboardingStore(
    (s) => s.setShowSamplePreview,
  );
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );
  const { project, organization } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();
  const [token, setToken] = useState<string | null>(null);
  const [showSdk, setShowSdk] = useState(false);
  // The same endpoint rule the env block above the actions follows, so
  // the keys the agent gets and the keys on screen are the same keys.
  const endpoint = selfHostedEndpoint(publicEnv.data?.BASE_HOST);

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
    <IntegratePaneShell ariaLabel="Integrate your code" chrome={<PageChrome />}>
      <ActiveProjectProvider value={activeProjectContext}>
        {/* Namespaces the analytics events the lifted onboarding
            sections emit (prompt / skill / config copies) here. */}
        <AnalyticsBoundary name="traces_integrate">
          <VStack align="stretch" gap={6}>
            <VStack align="stretch" gap={1.5} minWidth={0}>
              <Text
                textStyle="2xl"
                fontWeight="600"
                color="fg"
                letterSpacing="-0.015em"
              >
                Instrument your agents in seconds
              </Text>
              <Text textStyle="sm" color="fg.muted" lineHeight="tall">
                Mint a token, then hand the setup to your coding agent or follow
                the SDK instructions.
              </Text>
            </VStack>

            <ApiKeyIntegrationInfoCard
              organizationId={organization.id}
              projectId={project.id}
              token={token}
              onTokenGenerated={setToken}
            />

            <SetupActions
              token={token}
              endpoint={endpoint}
              showSdk={showSdk}
              onToggleSdk={() => setShowSdk((shown) => !shown)}
              onEnterSampleMode={enterSampleMode}
            />

            {showSdk && <SdkSetup />}
          </VStack>
        </AnalyticsBoundary>
      </ActiveProjectProvider>
    </IntegratePaneShell>
  );
};

/**
 * The ways forward, under the token because that is the order they
 * happen in, and centred because none of the three is the one
 * everybody takes. They wrap rather than shrink, so a phone gets three
 * readable buttons on as many rows as it needs.
 */
function SetupActions({
  token,
  endpoint,
  showSdk,
  onToggleSdk,
  onEnterSampleMode,
}: {
  token: string | null;
  /** Set only on a self-hosted deployment, matching the env block above. */
  endpoint: string | null;
  showSdk: boolean;
  onToggleSdk: () => void;
  onEnterSampleMode: () => void;
}) {
  return (
    <HStack gap={2} justify="center" wrap="wrap">
      <SetupWithAgentButton
        surface="traces"
        apiKey={token ?? undefined}
        endpoint={endpoint ?? undefined}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={onToggleSdk}
        aria-expanded={showSdk}
      >
        <Icon as={Code2} boxSize={4} />
        See SDK instructions
      </Button>
      <Button
        size="sm"
        variant="outline"
        colorPalette="orange"
        onClick={onEnterSampleMode}
        transition="all 0.15s ease"
        _hover={{
          bg: "orange.subtle",
          borderColor: "orange.emphasized",
          transform: "translateY(-1px)",
        }}
        _active={{ bg: "orange.muted", transform: "translateY(0)" }}
      >
        <Icon as={Compass} boxSize={4} />
        See sample data
      </Button>
    </HStack>
  );
}

/**
 * The real SearchBar and Toolbar in a non-interactive treatment, so the
 * page still reads as the trace explorer (just empty). Pointer events
 * off, focus skips via `inert` (set imperatively, because the JSX prop
 * is dropped silently by older React versions while the IDL property
 * always sticks), aria-hidden for screen readers, user-select none so
 * the text cannot even be highlighted. `tabIndex={-1}` is the belt: if
 * `inert` is ever stripped by a Chakra update, the wrapper still
 * refuses focus.
 */
function PageChrome() {
  const chromeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chromeRef.current;
    if (el) el.inert = true;
  }, []);

  return (
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
      // The chrome is context, not content: it says "this is the trace
      // page, just empty". A phone has no room to say that, and the
      // toolbar collapses into overlapping icons trying.
      display={{ base: "none", md: "block" }}
    >
      <SearchBar />
      {/* `hideSampleDataAction` collapses the toolbar's own "See sample
          data" toggle: the actions under the token block are the
          canonical entry point in the empty-trace state. */}
      <Toolbar hideSampleDataAction />
    </Box>
  );
}
