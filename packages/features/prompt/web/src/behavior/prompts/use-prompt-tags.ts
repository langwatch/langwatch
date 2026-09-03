import { useMemo } from "react";

import { api } from "@langwatch/workflow-web/studio-host/api";

export type TagDefinition = {
  name: string;
  id?: string;
};

export function usePromptTags({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const query = api.promptTags.getAll.useQuery({ projectId }, { enabled: enabled && !!projectId });

  // Memoized because callers put this array in effect dependencies. Mapping on
  // every render hands them a new reference each time, so an effect that reads
  // it and sets state re-arms itself from its own commit and the component
  // renders without ever settling.
  const data: TagDefinition[] = useMemo(
    () => (query.data ?? []).map((t: any) => ({ name: t.name, id: t.id })),
    [query.data],
  );

  return {
    data,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
