import { useEffect, useState } from "react";
import type { PromptRef } from "../model/trace-generator";
import { useFoundryTransport } from "./foundry-runtime";

export function useFoundryPrompts({
  enabled,
  projectId,
}: {
  enabled: boolean;
  projectId: string | null;
}) {
  const { loadPrompts } = useFoundryTransport();
  const [prompts, setPrompts] = useState<PromptRef[] | undefined>(void 0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setPrompts(void 0);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    void loadPrompts(projectId).then(
      (nextPrompts) => {
        if (active) {
          setPrompts(nextPrompts);
          setIsLoading(false);
        }
      },
      () => {
        if (active) {
          setPrompts([]);
          setIsLoading(false);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, loadPrompts, projectId]);

  return { prompts, isLoading };
}
