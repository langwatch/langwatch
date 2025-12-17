import { Box, HStack, Heading, Spacer, VStack } from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { CurrentDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { AgentConfigPanel } from "~/evaluations-v3/components/AgentSection/AgentConfigOverlay";
import { EvaluationsV3Table } from "~/evaluations-v3/components/EvaluationsV3Table";
import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";

/**
 * Evaluations V3 Page
 *
 * Main page for the new spreadsheet-like evaluation experience.
 */
export default function EvaluationsV3Page() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug = router.query.slug as string | undefined;

  const { name, reset, setExperimentSlug } = useEvaluationsV3Store((state) => ({
    name: state.name,
    reset: state.reset,
    setExperimentSlug: state.setExperimentSlug,
  }));

  // Set the experiment slug when the page loads
  useEffect(() => {
    if (slug) {
      setExperimentSlug(slug);
    }
  }, [slug, setExperimentSlug]);

  // Reset store when leaving the page
  useEffect(() => {
    return () => {
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) {
    return <LoadingScreen />;
  }

  if (!slug) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout backgroundColor="white">
      <VStack
        width="full"
        height="calc(100vh - 50px)"
        gap={0}
        align="stretch"
        overflow="hidden"
      >
        {/* Header */}
        <HStack paddingX={6} paddingY={3} flexShrink={0}>
          <Heading size="md">{name || "New Evaluation"}</Heading>
          <Spacer />
          {/* Toolbar buttons will go here */}
        </HStack>

        {/* Main content - table container with config panel */}
        <Box
          flex={1}
          position="relative"
          overflow="hidden"
          marginLeft={4}
          marginTop={2}
          borderTopLeftRadius="xl"
          borderLeft="1px solid"
          borderTop="1px solid"
          borderColor="gray.200"
          bg="white"
        >
          <Box
            position="absolute"
            inset={0}
            overflow="auto"
          >
            <EvaluationsV3Table />
          </Box>
          <AgentConfigPanel />
        </Box>
      </VStack>

      <CurrentDrawer />
    </DashboardLayout>
  );
}
