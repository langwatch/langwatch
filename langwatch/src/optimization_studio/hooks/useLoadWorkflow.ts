import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

export const useLoadWorkflow = () => {
  const router = useRouter();
  const workflowId =
    typeof router.query.workflow === "string"
      ? router.query.workflow
      : undefined;
  const { project } = useOrganizationTeamProject();
  const workflow = api.workflow.getById.useQuery(
    { workflowId: workflowId ?? "", projectId: project?.id ?? "" },
    { enabled: !!project && !!workflowId, staleTime: Infinity }
  );

  return { workflow };
};
