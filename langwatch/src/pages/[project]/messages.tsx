import { MessagesTable } from "~/components/messages/MessagesTable";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useTableView } from "../../components/messages/HeaderButtons";
import { MessagesList } from "../../components/messages/MessagesList";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import WelcomeLayout from "../../components/welcome/WelcomeLayout";
import { useFieldRedaction } from "../../hooks/useFieldRedaction";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function MessagesOrIntegrationGuideContent() {
  const { project } = useOrganizationTeamProject();

  const firstMessageCheck = api.project.getHasFirstMessage.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id, staleTime: 0 },
  );
  const hasFirstMessage = Boolean(firstMessageCheck.data?.firstMessage);

  const { isTableView } = useTableView();

  // Preload field redaction status to avoid cascading loading states
  useFieldRedaction("input");

  if (project && firstMessageCheck.isFetched && !hasFirstMessage) {
    return (
      <DashboardLayout>
        <WelcomeLayout />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {isTableView ? <MessagesTable /> : <MessagesList />}
    </DashboardLayout>
  );
}

export default withPermissionGuard("traces:view", {
  layoutComponent: DashboardLayout,
})(MessagesOrIntegrationGuideContent);
