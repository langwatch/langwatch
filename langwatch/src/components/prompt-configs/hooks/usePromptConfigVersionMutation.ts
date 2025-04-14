import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";

interface UsePromptConfigVersionMutationProps {
  configId: string;
  onSuccess?: () => void;
}

export const usePromptConfigVersionMutation = ({
  configId,
  onSuccess,
}: UsePromptConfigVersionMutationProps) => {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  return api.llmConfigs.versions.create.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Success",
        description: "New version created successfully",
        type: "success",
        placement: "top-end",
        meta: { closable: true },
      });
      void utils.llmConfigs.getPromptConfigs.invalidate();
      void utils.llmConfigs.versions.getById.invalidate({
        id: configId,
        projectId: project?.id ?? "",
      });
      onSuccess?.();
    },
    onError: (error) => {
      toaster.create({
        title: "Error",
        description: error.message,
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
    },
  });
};
