import { Alert, Box, Center, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import {
  createInitialState,
  type DatasetColumn,
  type DatasetReference,
  type SavedRecord,
} from "~/experiments-v3/types";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { DatasetColumns } from "~/server/datasets/types";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Builds a saved dataset reference from a loaded dataset, mirroring the
 * conversion the workbench uses when a saved dataset is picked.
 */
function toSavedDatasetReference(dataset: {
  id: string;
  name: string;
  columnTypes: DatasetColumns;
  datasetRecords: Array<{ id: string; entry: unknown }>;
}): DatasetReference {
  const columns: DatasetColumn[] = dataset.columnTypes.map((col, index) => ({
    id: `${col.name}_${index}`,
    name: col.name,
    type: col.type,
  }));

  const savedRecords: SavedRecord[] = dataset.datasetRecords.map((record) => ({
    id: record.id,
    ...Object.fromEntries(
      dataset.columnTypes.map((col) => {
        const value = (record.entry as Record<string, unknown>)?.[col.name];
        if (value === null || value === undefined) return [col.name, ""];
        if (typeof value === "string") return [col.name, value];
        return [col.name, JSON.stringify(value)];
      }),
    ),
  }));

  return {
    id: `saved_${dataset.id}`,
    name: dataset.name,
    type: "saved",
    datasetId: dataset.id,
    columns,
    savedRecords,
  };
}

/**
 * New Experiment Workbench Page
 *
 * Creates a new experiment on the server and redirects to the slug page.
 * When a `datasetId` query param is present (e.g. "Run experiment" from a
 * dataset), the new experiment is seeded with that saved dataset.
 */
export default function NewExperimentWorkbench() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const hasCreatedRef = useRef(false);

  const datasetId =
    typeof router.query.datasetId === "string"
      ? router.query.datasetId
      : undefined;

  const datasetQuery = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    { enabled: !!project?.id && !!datasetId },
  );

  const createExperiment = api.experiments.saveEvaluationsV3.useMutation();

  // Wait for the seeding dataset to load before creating the experiment.
  const isDatasetReady = !datasetId || !!datasetQuery.data;

  useEffect(() => {
    if (!project || hasCreatedRef.current || !isDatasetReady) return;

    hasCreatedRef.current = true;

    void (async () => {
      try {
        const initialState = createInitialState();

        if (datasetId && datasetQuery.data) {
          const seeded = toSavedDatasetReference({
            id: datasetId,
            name: datasetQuery.data.name,
            columnTypes: datasetQuery.data.columnTypes as DatasetColumns,
            datasetRecords: datasetQuery.data.datasetRecords ?? [],
          });
          initialState.datasets = [seeded];
          initialState.activeDatasetId = seeded.id;
        }

        const persistedState = extractPersistedState(initialState);

        const experiment = await createExperiment.mutateAsync({
          projectId: project.id,
          experimentId: undefined,
          state: persistedState as Parameters<
            typeof createExperiment.mutateAsync
          >[0]["state"],
        });

        void router.replace(
          `/${project.slug}/experiments/workbench/${experiment.slug}`,
        );
      } catch (error) {
        console.error("Failed to create new experiment:", error);
        // hasCreatedRef stays true to prevent retry loops
        // Error will be shown in the UI via createExperiment.isError
      }
    })();
  }, [
    project,
    router,
    createExperiment,
    isDatasetReady,
    datasetId,
    datasetQuery.data,
  ]);

  return (
    <DashboardLayout backgroundColor="bg.panel" compactMenu={true}>
      <Center height="calc(100vh - 100px)">
        {createExperiment.isError ? (
          <Box padding={6} maxWidth="500px">
            <Alert.Root status="error">
              <Alert.Indicator />
              <VStack align="start" gap={1}>
                <Alert.Title>Failed to create experiment</Alert.Title>
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
