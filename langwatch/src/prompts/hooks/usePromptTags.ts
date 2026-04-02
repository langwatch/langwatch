import { useCallback, useEffect, useState } from "react";

export type TagDefinition = {
  name: string;
  id?: string;
};

type ApiTagResponse = {
  name: string;
  id?: string;
  createdAt?: string;
};

export function usePromptTags({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  const [data, setData] = useState<TagDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTags = useCallback(async () => {
    if (!organizationId) return;
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/orgs/${organizationId}/prompt-tags`,
      );
      if (!response.ok) {
        setData([]);
        return;
      }
      const json = (await response.json()) as ApiTagResponse[];
      setData(json.map((t) => ({ name: t.name, id: t.id })));
    } catch {
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!enabled) return;
    void fetchTags();
  }, [enabled, fetchTags]);

  return { data, isLoading, refetch: fetchTags };
}
