import { MessagesDevMode } from "~/components/MessagesTable";
import { DashboardLayout } from "../../components/DashboardLayout";
import { ProjectIntegration } from "../../components/ProjectIntegration";
import { useDevView } from "../../hooks/DevViewProvider";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { MessagesList } from "../../components/MessagesList";

export default function MessagesOrIntegrationGuide() {
  const { project } = useOrganizationTeamProject();

  const { isDevViewEnabled } = useDevView();

  if (project && !project.firstMessage) {
    return <ProjectIntegration />;
  }

  if (isDevViewEnabled) {
    return <MessagesDevMode />;
  }

  return (
    <DashboardLayout>
      <MessagesList />
    </DashboardLayout>
  );
}
