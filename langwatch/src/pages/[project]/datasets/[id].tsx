import { Box } from "@chakra-ui/react";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { DatasetEditorTable } from "~/components/datasets/editor/DatasetEditorTable";

export default function Dataset() {
  const router = useRouter();
  const datasetId = router.query.id;

  return (
    <DashboardLayout>
      <Box width="full" paddingX={6} paddingY={6}>
        <DatasetEditorTable datasetId={datasetId as string} />
      </Box>
    </DashboardLayout>
  );
}
