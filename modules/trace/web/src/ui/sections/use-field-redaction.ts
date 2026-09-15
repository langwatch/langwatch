import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { api } from "../../behavior/trace-api.ts";

export const useFieldRedaction = (field: "input" | "output") => {
  const isSharePage = typeof window !== "undefined" && window.location.pathname.includes("/share/");
  if (isSharePage) {
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
