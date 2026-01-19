import { useLocalStorage } from "usehooks-ts";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

interface RecentTarget {
  id: string;
  timestamp: number;
}

const MAX_RECENT_ITEMS = 5;

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

  const [recentPrompts, setRecentPrompts] = useLocalStorage<RecentTarget[]>(
    promptStorageKey,
    [],
  );

  const [recentAgents, setRecentAgents] = useLocalStorage<RecentTarget[]>(
    agentStorageKey,
    [],
  );

  const addRecentPrompt = (promptId: string) => {
    setRecentPrompts((prev) => {
      // Remove if already exists, then add to front
      const filtered = prev.filter((p) => p.id !== promptId);
      const updated = [{ id: promptId, timestamp: Date.now() }, ...filtered];
      return updated.slice(0, MAX_RECENT_ITEMS);
    });
  };

  const addRecentAgent = (agentId: string) => {
    setRecentAgents((prev) => {
      // Remove if already exists, then add to front
      const filtered = prev.filter((a) => a.id !== agentId);
      const updated = [{ id: agentId, timestamp: Date.now() }, ...filtered];
      return updated.slice(0, MAX_RECENT_ITEMS);
    });
  };

  return {
    recentPromptIds: recentPrompts.map((p) => p.id),
    recentAgentIds: recentAgents.map((a) => a.id),
    addRecentPrompt,
    addRecentAgent,
  };
}
