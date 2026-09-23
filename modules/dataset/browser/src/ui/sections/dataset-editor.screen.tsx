// Dataset editor respecting I-READY gate; dataset ID from host route (screen decides readiness).

import { Alert, Box, Button, Spinner, Text } from "@chakra-ui/react";
import { datasetContextChip, useRegisterLangyPageContext } from "@langwatch/langy-browser-kit";
import { FlaskConical } from "lucide-react";
import { useState } from "react";

import { datasetApi } from "../../behavior/dataset-api.ts";
import { retryDatasetNormalize } from "../../behavior/direct-upload.ts";
import { useDatasetHost } from "../../model/dataset-host.ts";
import { DatasetEditorTable } from "./dataset-editor-table.tsx";

/**
 * The grant that offers the workbench hand-off. Read from the host, not
 * declared by the feature, because it gates a BUTTON, not the page — a
 * reader without it still opens the dataset, just isn't offered the experiment.
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
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        const isPreparing = status === "processing" || status === "uploading";

        return isPreparing ? PREPARING_POLL_MS : false;
      },
    },
  );

  const datasetName = datasetQuery.data?.name;
  useRegisterLangyPageContext(
    datasetId && datasetName ? [datasetContextChip({ datasetId, name: datasetName })] : [],
  );
  const status = datasetQuery.data?.status;
  // `getById` returns null for an archived or deleted dataset rather than
  // throwing: surface that explicitly rather than treating the absent row as
  // "ready" via the legacy-null branch below.
  const datasetGone = datasetQuery.isSuccess && datasetQuery.data == null;
  // Gate on `isSuccess` AND a present row: before resolving, `status` is
  // `undefined`, and `undefined == null` is `true` — which would mount the
  // editor against a still-processing dataset before status is known. Once
  // settled, a genuinely-null status (legacy rows) still reads as ready.
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
