import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

export const useFieldRedaction = (field: "input" | "output") => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const { data: isRedacted, isLoading } = api.project.getFieldRedactionStatus.useQuery(
    {
      projectId: projectId ?? "",
      field: field,
    },
    {
      enabled: !!projectId,
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: true,
    }
  );

  return {
    isRedacted: isLoading ? void 0 : isRedacted,
    isLoading,
  };
}; 
