import { useLocalStorage } from "usehooks-ts";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

const MAX_RECENT_ITEMS = 5;

/**
 * Creates a function that adds an ID to the front of a recent list,
 * removing duplicates and limiting to MAX_RECENT_ITEMS.
 */
function createAddRecent(
  setter: React.Dispatch<React.SetStateAction<string[]>>,
) {
  return (id: string) => {
    setter((prev) => {
      const filtered = prev.filter((existingId) => existingId !== id);
      const updated = [id, ...filtered];
      return updated.slice(0, MAX_RECENT_ITEMS);
    });
  };
}

/**
 * Hook for tracking recently used targets globally (not per scenario).
 * Separate tracking for prompts and agents.
 */
export function useRecentTargets() {
  const { project } = useOrganizationTeamProject();

  const promptStorageKey = project?.id
    ? `langwatch:recent-prompts:${project.id}`
    : "langwatch:recent-prompts:temp";

  const agentStorageKey = project?.id
    ? `langwatch:recent-agents:${project.id}`
    : "langwatch:recent-agents:temp";

  const [recentPromptIds, setRecentPromptIds] = useLocalStorage<string[]>(
    promptStorageKey,
    [],
  );

  const [recentAgentIds, setRecentAgentIds] = useLocalStorage<string[]>(
    agentStorageKey,
    [],
  );

  const addRecentPrompt = createAddRecent(setRecentPromptIds);
  const addRecentAgent = createAddRecent(setRecentAgentIds);

  return {
    recentPromptIds,
    recentAgentIds,
    addRecentPrompt,
    addRecentAgent,
  };
}
