import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

/** The stored version behind each reference, one query each, in the order given. */
export function useSavedPromptVersions({
  references,
  enabled,
}: {
  references: { configId: string; versionId: string | undefined }[];
  enabled: boolean;
}) {
  const { project } = usePromptProject();
  const projectId = project?.id ?? "";
  return promptApi.useQueries((t) =>
    references.map(({ configId, versionId }) =>
      t.prompts.getByIdOrHandle(
        { idOrHandle: configId, projectId, versionId },
        { enabled: enabled && !!projectId },
      ),
    ),
  );
}
