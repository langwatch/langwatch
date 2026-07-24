import { api } from "~/utils/api";

export type TagDefinition = {
  name: string;
  id?: string;
};

export function usePromptTags({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const query = api.promptTags.getAll.useQuery(
    { projectId },
    { enabled: enabled && !!projectId },
  );

  const data: TagDefinition[] = (query.data ?? []).map((t) => ({
    name: t.name,
    id: t.id,
  }));

  return {
    data,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
