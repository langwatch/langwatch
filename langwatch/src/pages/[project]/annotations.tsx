import { Box } from "@chakra-ui/react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { DashboardLayout } from "../../components/DashboardLayout";

function AnnotationsContent() {
  return (
    <AnnotationsLayout>
      <Box backgroundColor="white" width="full" overflowX="auto">
        <AnnotationsTable
          showQueueAndUser={true}
          heading="Inbox"
          noDataTitle="Your inbox is empty"
          noDataDescription="Send messages to your annotation queue to get started."
        />
      </Box>
    </AnnotationsLayout>
  );
}

export default withPermissionGuard("annotations:view", {
  layoutComponent: DashboardLayout,
})(AnnotationsContent);
