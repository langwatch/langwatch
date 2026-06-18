import { Alert, Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { DatasetEditorTable } from "~/components/datasets/editor/DatasetEditorTable";
import { retryDatasetNormalize } from "~/components/datasets/services/directUpload";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

export default function Dataset() {
  const router = useRouter();
  const datasetId = router.query.id as string;
  const { project, hasPermission } = useOrganizationTeamProject();
  const [isRetrying, setIsRetrying] = useState(false);

  // Lifted to the page so the read-gate and the processing banner are decided
  // here (ADR-032 I-READY), and the editor only reads records once ready.
  const datasetQuery = api.dataset.getById.useQuery(
    { projectId: project?.id ?? "", datasetId },
    {
      enabled: !!project && !!datasetId,
      // Poll only while preparing; the functional form lets the query schedule
      // its own stop once the status settles (mirrors useTraceFacets).
      refetchInterval: (data) =>
        data?.status === "processing" || data?.status === "uploading"
          ? 3000
          : false,
    },
  );

  const status = datasetQuery.data?.status;
  const isReady = status === "ready" || status == null;

  const runExperiment = () => {
    void router.push({
      pathname: `/${project?.slug}/experiments/workbench`,
      query: { datasetId },
    });
  };

  const handleRetry = async () => {
    if (!project) return;
    setIsRetrying(true);
    try {
      await retryDatasetNormalize({ projectId: project.id, datasetId });
      await datasetQuery.refetch();
    } catch (error) {
      toaster.create({
        title: "Could not retry",
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
        type: "error",
        meta: { closable: true },
      });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <DashboardLayout>
      <Box width="full" paddingX={6} paddingY={6}>
        {(status === "uploading" || status === "processing") && (
          <Alert.Root status="info" marginBottom={4}>
            <Alert.Indicator>
              <Spinner size="sm" />
            </Alert.Indicator>
            <Alert.Content>
              <Alert.Title>
                Preparing your dataset, this can take a few minutes
              </Alert.Title>
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
        {isReady ? (
          <DatasetEditorTable
            datasetId={datasetId}
            readEnabled={isReady}
            floatingSelectionBar
            headerActions={
              hasPermission("evaluations:manage") ? (
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
          status !== "failed" && (
            <Text color="fg.muted">
              Your dataset will appear here once it is ready.
            </Text>
          )
        )}
      </Box>
    </DashboardLayout>
  );
}
