import { api } from "~/utils/api";

export const usePromptConfigNameMutation = ({
  onSuccess,
}: Parameters<typeof api.llmConfigs.updatePromptConfig.useMutation>[0]) => {
  const utils = api.useContext();

  return api.llmConfigs.updatePromptConfig.useMutation({
    onSuccess: (data) => {
      void utils.llmConfigs.getPromptConfigs.invalidate();
      onSuccess?.(data);
    },
  });
};
