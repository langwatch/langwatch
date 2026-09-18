import { useRouter } from "@langwatch/browser-host/use-router";
import { useOrganizationTeamProject } from "../studio-host/use-organization-team-project.ts";
import { api as workflowApi } from "@langwatch/browser-trpc/workflow-api";

export const useLoadWorkflow = () => {
  const router = useRouter();
  const workflowId = typeof router.query.workflow === "string" ? router.query.workflow : undefined;
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
