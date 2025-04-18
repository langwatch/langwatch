import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface UsePromptConfigVersionMutationProps {
  onSuccess?: () => void;
}

export const usePromptConfigVersionMutation = (
  props?: UsePromptConfigVersionMutationProps
) => {
  const { onSuccess } = props ?? {};
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
      void utils.llmConfigs.versions.getById.invalidate();
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
