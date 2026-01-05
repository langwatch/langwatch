import { useRouter } from "next/router";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import AnalyticsCustomGraph, { type CustomGraphFormData } from "./index";

export default function EditCustomAnalyticsPage() {
  const router = useRouter();
  const graphId = router.query.id as string;

  const { project } = useOrganizationTeamProject();

  const graphData = api.graphs.getById.useQuery({
    projectId: project?.id ?? "",
    id: graphId ?? "",
  });

  const graph = graphData.data?.graph;
  const name = graphData.data?.name;
  const rawAlert = graphData.data?.alert;
  const alert: CustomGraphFormData["alert"] | undefined =
    rawAlert != null &&
    rawAlert.type != null &&
    (rawAlert.action === "SEND_EMAIL" ||
      rawAlert.action === "SEND_SLACK_MESSAGE")
      ? (rawAlert as unknown as CustomGraphFormData["alert"])
      : undefined;

  return graph ? (
    <AnalyticsCustomGraph
      customId={graphId}
      graph={graph as CustomGraphInput}
      name={name ?? ""}
      filters={graphData.data?.filters}
      alert={alert}
    />
  ) : null;
}
