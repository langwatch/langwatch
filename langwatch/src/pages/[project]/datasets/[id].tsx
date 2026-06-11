import { Box, Button } from "@chakra-ui/react";
import { FlaskConical } from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";

import { DashboardLayout } from "~/components/DashboardLayout";
import { DatasetEditorTable } from "~/components/datasets/editor/DatasetEditorTable";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export default function Dataset() {
  const router = useRouter();
  const datasetId = router.query.id as string;
  const { project, hasPermission } = useOrganizationTeamProject();

  const runExperiment = () => {
    void router.push({
      pathname: `/${project?.slug}/experiments/workbench`,
      query: { datasetId },
    });
  };

  return (
    <DashboardLayout>
      <Box width="full" paddingX={6} paddingY={6}>
        <DatasetEditorTable
          datasetId={datasetId}
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
      </Box>
    </DashboardLayout>
  );
}
