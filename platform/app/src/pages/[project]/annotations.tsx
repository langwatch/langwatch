import { Flex } from "@chakra-ui/react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { DashboardLayout } from "../../components/DashboardLayout";

function AnnotationsContent() {
  return (
    <AnnotationsLayout>
      {/* `minWidth={0}` lets the column shrink inside the sidebar row, so wide
          columns scroll inside the table instead of pushing the page sideways. */}
      <Flex direction="column" flex={1} minWidth={0} height="full">
        <AnnotationsTable
          showQueueAndUser={true}
          heading="Inbox"
          dateColumnLabel="Date queued"
          showStatusFilter={true}
          rowTarget="queueItem"
          noDataTitle="Your inbox is empty"
          noDataDescription="Send messages to your annotation queue to get started."
        />
      </Flex>
    </AnnotationsLayout>
  );
}

export default withPermissionGuard("annotations:view", {
  layoutComponent: DashboardLayout,
})(AnnotationsContent);
