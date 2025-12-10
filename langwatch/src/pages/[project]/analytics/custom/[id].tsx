import { useRouter } from "next/router";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import AnalyticsCustomGraph from "./index";

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

  return graph ? (
    <AnalyticsCustomGraph
      customId={graphId}
      graph={graph as CustomGraphInput}
      name={name ?? ""}
      filters={graphData.data?.filters}
      alert={graphData.data?.alert}
    />
  ) : null;
}
