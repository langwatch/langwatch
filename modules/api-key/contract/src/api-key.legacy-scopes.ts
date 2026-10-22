import type { AuthzPermission } from "@langwatch/authorization";

/**
 * Per-scope flags for a legacy project key (`Project.apiKey`), one entry per flag: each names
 * the permissions it grants beyond ingestion when its rule lists the project
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export const LEGACY_PROJECT_KEY_SCOPES = {
  /** `prompts.get` in the SDKs and the prompt list. */
  legacy_project_key_prompts_read: ["prompts:view"],
  /** Prompt create, update, version restore, sync and tag writes. */
  legacy_project_key_prompts_write: ["prompts:create", "prompts:update", "prompts:manage"],
  /** REST trace reads and search. */
  legacy_project_key_traces_read: ["traces:view"],
  /** Scenario events and simulation runs, as the scenario SDK reports them. */
  legacy_project_key_scenarios: ["scenarios:view", "scenarios:create"],
  /** Evaluators and guardrails run over REST, and the evaluator lookup before a run. */
  legacy_project_key_evaluations: ["evaluations:view", "evaluations:manage"],
  /** CI/CD experiment runs, SDK experiment init and batch results, and the datasets they read. */
  legacy_project_key_experiments: [
    "experiments:view",
    "experiments:create",
    "experiments:update",
    "experiments:manage",
    "evaluations:view",
    "evaluations:create",
    "evaluations:manage",
    "datasets:view",
  ],
  /** Connected-agent register, poll, frames and socket, and the model providers they read. */
  legacy_project_key_connected_agents: ["scenarios:manage", "project:view"],
} as const satisfies Record<string, readonly AuthzPermission[]>;

export type LegacyProjectKeyScopeFlag = keyof typeof LEGACY_PROJECT_KEY_SCOPES;

const SCOPE_FLAGS = Object.keys(LEGACY_PROJECT_KEY_SCOPES) as LegacyProjectKeyScopeFlag[];

/** The scope flags that grant this permission; empty when only full access does. */
export function legacyProjectKeyScopeFlagsGranting(
  permission: AuthzPermission,
): readonly LegacyProjectKeyScopeFlag[] {
  return SCOPE_FLAGS.filter((flag) =>
    (LEGACY_PROJECT_KEY_SCOPES[flag] as readonly AuthzPermission[]).includes(permission),
  );
}
