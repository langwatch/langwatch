import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

export const useFieldRedaction = (field: "input" | "output") => {
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
    }
  );

  return {
    isRedacted: isLoading ? void 0 : data?.isRedacted[field],
    isLoading,
  };
};
