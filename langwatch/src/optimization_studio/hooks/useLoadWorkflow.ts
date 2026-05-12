import { useRouter } from "~/utils/compat/next-router";
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
