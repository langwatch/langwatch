import { Alert, Box, Center, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { createInitialState } from "~/evaluations-v3/types";
import { extractPersistedState } from "~/evaluations-v3/types/persistence";
import { api } from "~/utils/api";

/**
 * New Evaluation V3 Page
 *
 * Creates a new evaluation on the server and redirects to the slug page.
 * This ensures the experiment exists before navigating to /v3/[slug].
 */
export default function NewEvaluationV3() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const hasCreatedRef = useRef(false);

  const createExperiment = api.experiments.saveEvaluationsV3.useMutation();

  useEffect(() => {
    if (!project || hasCreatedRef.current) return;

    hasCreatedRef.current = true;

    void (async () => {
      try {
        // Create initial state with default dataset content
        const initialState = createInitialState();
        const persistedState = extractPersistedState(initialState);

        // Create a new experiment on the server
        const experiment = await createExperiment.mutateAsync({
          projectId: project.id,
          experimentId: undefined, // New experiment
          state: persistedState as Parameters<
            typeof createExperiment.mutateAsync
          >[0]["state"],
        });

        // Redirect to the new experiment
        void router.replace(
          `/${project.slug}/evaluations/v3/${experiment.slug}`,
        );
      } catch (error) {
        console.error("Failed to create new evaluation:", error);
        // hasCreatedRef stays true to prevent retry loops
        // Error will be shown in the UI via createExperiment.isError
      }
    })();
  }, [project, router, createExperiment]);

  return (
    <DashboardLayout backgroundColor="white" compactMenu={true}>
      <Center height="calc(100vh - 100px)">
        {createExperiment.isError ? (
          <Box padding={6} maxWidth="500px">
            <Alert.Root status="error">
              <Alert.Indicator />
              <VStack align="start" gap={1}>
                <Alert.Title>Failed to create evaluation</Alert.Title>
                <Alert.Description>
                  {createExperiment.error?.message ??
                    "An unexpected error occurred."}
                </Alert.Description>
              </VStack>
            </Alert.Root>
          </Box>
        ) : null}
      </Center>
    </DashboardLayout>
  );
}
