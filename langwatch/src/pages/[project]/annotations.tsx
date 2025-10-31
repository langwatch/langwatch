import { Box } from "@chakra-ui/react";

import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { PermissionAlert } from "../../components/PermissionAlert";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../components/DashboardLayout";
export default function Annotations() {
  const { hasPermission } = useOrganizationTeamProject();
  const hasAnnotationsViewPermission = hasPermission("annotations:view");
  if (!hasAnnotationsViewPermission) {
    return (
      <DashboardLayout>
        <PermissionAlert permission="annotations:view" />
      </DashboardLayout>
    );
  }
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
