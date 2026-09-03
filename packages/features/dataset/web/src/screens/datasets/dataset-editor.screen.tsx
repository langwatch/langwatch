/**
 * One dataset, open in the editor.
 *
 * Moved from `platform/app/src/pages/[project]/datasets/[id].tsx`. The read gate
 * and the preparing/failed banners are decided HERE (ADR-032 I-READY) and the
 * editor only reads records once the dataset is ready, exactly as the page did.
 *
 * The dataset id comes off the address through the host's route reading rather
 * than through a router hook, which a screen closure may not reach.
 *
 * Spec: specs/datasets/dataset-editor.feature.
 */

import { Alert, Box, Button, Spinner, Text } from "@chakra-ui/react";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { datasetApi } from "../../behavior/dataset-api";
import { useDatasetHost } from "../../model/dataset-host";
import { retryDatasetNormalize } from "../../behavior/direct-upload";
import { DatasetEditorTable } from "../../ui/sections/dataset-editor-table";

/**
 * The grant that offers the workbench hand-off.
 *
 * Read from the host rather than declared by the frontend feature, because it
 * gates a BUTTON rather than the page: a reader without it still opens the
 * dataset, they are just not offered the experiment.
 */
const EXPERIMENT_PERMISSION = "evaluations:manage";

/** How often a preparing dataset is re-read while the normalize job runs. */
const PREPARING_POLL_MS = 3000;

export default function DatasetEditorScreen() {
  const host = useDatasetHost();
  const project = host.project();
  const datasetId = host.route().params.id ?? "";
  const [isRetrying, setIsRetrying] = useState(false);

  const datasetQuery = datasetApi.dataset.getById.useQuery(
    { projectId: project?.id ?? "", datasetId },
    {
      enabled: !!project && !!datasetId,
      // Poll only while preparing; the functional form lets the query schedule
      // its own stop once the status settles.
      refetchInterval: (query) =>
        query.state.data?.status === "processing" || query.state.data?.status === "uploading"
          ? PREPARING_POLL_MS
          : false,
    },
  );

  const status = datasetQuery.data?.status;
  // `getById` returns null for an archived or deleted dataset rather than
  // throwing: surface that explicitly rather than treating the absent row as
  // "ready" via the legacy-null branch below.
  const datasetGone = datasetQuery.isSuccess && datasetQuery.data == null;
  // Gate on `isSuccess` AND a present row: before the query resolves `status` is
  // `undefined`, and `undefined == null` is `true` — which would mount the
  // editor and read records from a still-`processing` (or missing) dataset (the
  // server refuses, and the refusal cascades into a retry toast) before the
  // status is known. Once the query settles on a real row, a genuinely-null
  // status (legacy rows born before the column) still reads as ready.
  const isReady =
    datasetQuery.isSuccess && datasetQuery.data != null && (status === "ready" || status == null);

  const runExperiment = () => {
    host.navigate(`/${project?.slug}/experiments/workbench?datasetId=${datasetId}`);
  };

  const handleRetry = async () => {
    if (!project) return;
    setIsRetrying(true);
    try {
      await retryDatasetNormalize({ projectId: project.id, datasetId });
      await datasetQuery.refetch();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't retry preparing this dataset" });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Box width="full" paddingX={6} paddingY={6}>
      {(status === "uploading" || status === "processing") && (
        <Alert.Root status="info" marginBottom={4}>
          <Alert.Indicator>
            <Spinner size="sm" />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Preparing your dataset, this can take a few minutes</Alert.Title>
          </Alert.Content>
        </Alert.Root>
      )}
      {status === "failed" && (
        <Alert.Root status="error" marginBottom={4}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>We could not prepare your dataset</Alert.Title>
            <Alert.Description>
              {datasetQuery.data?.statusError ??
                "Something went wrong while processing your file. You can retry."}
            </Alert.Description>
          </Alert.Content>
          <Button
            size="sm"
            colorPalette="red"
            variant="outline"
            loading={isRetrying}
            onClick={() => void handleRetry()}
          >
            Retry
          </Button>
        </Alert.Root>
      )}
      {datasetGone && <Text color="fg.muted">This dataset is no longer available.</Text>}
      {isReady ? (
        <DatasetEditorTable
          datasetId={datasetId}
          readEnabled={isReady}
          headerActions={
            host.hasPermission(EXPERIMENT_PERMISSION) ? (
              <Button
                size="sm"
                colorPalette="blue"
                data-testid="run-experiment-from-dataset"
                onClick={runExperiment}
              >
                <FlaskConical size={14} /> Run experiment
              </Button>
            ) : undefined
          }
        />
      ) : (
        status !== "failed" &&
        !datasetGone && (
          <Text color="fg.muted">Your dataset will appear here once it is ready.</Text>
        )
      )}
    </Box>
  );
}
