import { MessagesTable } from "~/components/messages/MessagesTable";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useIntegrationChecks } from "../../components/IntegrationChecks";
import { useTableView } from "../../components/messages/HeaderButtons";
import { MessagesList } from "../../components/messages/MessagesList";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import WelcomeLayout from "../../components/welcome/WelcomeLayout";
import { useFieldRedaction } from "../../hooks/useFieldRedaction";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

function MessagesOrIntegrationGuideContent() {
  const { project } = useOrganizationTeamProject();
  const integrationChecks = useIntegrationChecks();
  const hasFirstMessage = Boolean(integrationChecks.data?.firstMessage);

  const { isTableView } = useTableView();

  // Preload field redaction status to avoid cascading loading states
  useFieldRedaction("input");

  if (project && integrationChecks.isFetched && !hasFirstMessage) {
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
