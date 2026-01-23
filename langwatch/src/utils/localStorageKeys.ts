/**
 * Centralized localStorage key management to prevent conflicts.
 * All localStorage keys should be defined here.
 */

const PREFIX = "langwatch";

/**
 * Creates a namespaced localStorage key.
 * @param parts - Key parts to join with colons
 * @returns Formatted key like "langwatch:part1:part2"
 */
function createKey(...parts: string[]): string {
  return [PREFIX, ...parts].join(":");
}

/**
 * localStorage keys for the application.
 * Add new keys here to maintain a central registry.
 */
export const localStorageKeys = {
  // Recent targets (per project)
  recentPrompts: (projectId: string) =>
    createKey("recent-prompts", projectId || "temp"),
  recentAgents: (projectId: string) =>
    createKey("recent-agents", projectId || "temp"),

  // Scenario target selection (per project and scenario)
  scenarioTarget: (projectId: string, scenarioId?: string) =>
    scenarioId
      ? createKey("scenario-target", projectId, scenarioId)
      : createKey("scenario-target", "temp"),
} as const;
