import { z } from "zod";

/**
 * Scope flags for a legacy project key (`Project.apiKey`), one entry per flag. A flag opens only
 * the routes that name it with `withLegacyKeyScope(...)`, for the projects its rule lists
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export const LEGACY_PROJECT_KEY_SCOPE_FLAGS = [
  "legacy_project_key_prompts_read",
  "legacy_project_key_prompts_write",
  "legacy_project_key_traces_read",
  "legacy_project_key_scenarios",
  "legacy_project_key_evaluations",
  "legacy_project_key_experiments",
  "legacy_project_key_connected_agents",
] as const;

export const legacyProjectKeyScopeFlagSchema = z.enum(LEGACY_PROJECT_KEY_SCOPE_FLAGS);
