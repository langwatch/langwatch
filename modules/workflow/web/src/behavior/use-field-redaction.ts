import { api } from "../model/workflow-api-client.ts";
import { useOrganizationTeamProject } from "./studio-host/use-organization-team-project.ts";

export const useFieldRedaction = (field: "input" | "output") => {
  const isSharedView =
    typeof window !== "undefined" && window.location.pathname.includes("/share/");
  if (isSharedView) {
    return {
      isRedacted: false,
      isLoading: false,
      visibleTo: null,
    };
  }
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const { data, isLoading } = api.project.getFieldRedactionStatus.useQuery(
    {
      projectId: projectId ?? "",
    },
    {
      enabled: !!projectId,
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  return {
    isRedacted: isLoading ? void 0 : data?.isRedacted[field],
    isLoading,
    visibleTo: data?.visibleTo[field] ?? null,
  };
};
