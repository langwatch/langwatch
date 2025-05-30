import { MessagesTable } from "~/components/messages/MessagesTable";
import { DashboardLayout } from "../../components/DashboardLayout";
import { ProjectIntegration } from "../../components/ProjectIntegration";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { MessagesList } from "../../components/messages/MessagesList";
import { useTableView } from "../../components/messages/HeaderButtons";
import { api } from "../../utils/api";
import { useEffect, useState } from "react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useFieldRedaction } from "../../hooks/useFieldRedaction";

export default function MessagesOrIntegrationGuide() {
  const { project } = useOrganizationTeamProject();

  const { isTableView } = useTableView();

  const [waitingForFirstMessage, setWaitingForFirstMessage] = useState(false);

  const { filterParams } = useFilterParams();
  const traces = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      filters: {},
      pageSize: 1,
    },
    { enabled: !!project && waitingForFirstMessage }
  );

  // Preload field redaction status to avoid cascading loading states
  useFieldRedaction("input");

  useEffect(() => {
    if (!project) return;
    if (!project.firstMessage) {
      setWaitingForFirstMessage(true);
    } else if (
      waitingForFirstMessage &&
      traces.data &&
      traces.data.totalHits > 0
    ) {
      setWaitingForFirstMessage(false);
    }
  }, [project, traces.data, waitingForFirstMessage]);

  if (project && (!project.firstMessage || waitingForFirstMessage)) {
    return <ProjectIntegration />;
  }

  if (isTableView) {
    return (
      <DashboardLayout>
        <MessagesTable />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <MessagesList />
    </DashboardLayout>
  );
}
