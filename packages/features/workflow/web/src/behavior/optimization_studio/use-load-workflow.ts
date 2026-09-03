import { useRouter } from "../studio-host/next-router";
import { useOrganizationTeamProject } from "../studio-host/use-organization-team-project";
import { workflowApi } from "../workflow-api";

export const useLoadWorkflow = () => {
  const router = useRouter();
  const workflowId =
    typeof router.query.workflow === "string" ? router.query.workflow : undefined;
  const { project } = useOrganizationTeamProject();
  const workflow = workflowApi.workflow.getById.useQuery(
    { workflowId: workflowId ?? "", projectId: project?.id ?? "" },
    {
      enabled: !!project && !!workflowId,
      // One-shot bootstrap for the studio editor. The result feeds the
      // Zustand workflow store and AutoSave writes back from there — a
      // background refetch would clobber unsaved edits.
      staleTime: Infinity,
    },
  );

  return { workflow };
};
