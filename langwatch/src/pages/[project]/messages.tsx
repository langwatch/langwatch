import { MessagesTable } from "~/components/messages/MessagesTable";
import { DashboardLayout } from "../../components/DashboardLayout";
import { ProjectIntegration } from "../../components/ProjectIntegration";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { MessagesList } from "../../components/messages/MessagesList";
import { useTableView } from "../../components/messages/HeaderButtons";

export default function MessagesOrIntegrationGuide() {
  const { project } = useOrganizationTeamProject();

  const { isTableView } = useTableView();

  if (project && !project.firstMessage) {
    return <ProjectIntegration />;
  }

  if (isTableView) {
    return <MessagesTable />;
  }

  return (
    <DashboardLayout>
      <MessagesList />
    </DashboardLayout>
  );
}
