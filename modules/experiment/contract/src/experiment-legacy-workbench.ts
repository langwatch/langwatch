export const LEGACY_EXPERIMENT_TASK_TYPES = {
  real_time: "Real-time evaluation",
  llm_app: "Offline evaluation",
  prompt_creation: "Prompt Creation",
  custom_evaluator: "Evaluate your Evaluator",
  scan: "Scan for Vulnerabilities (Coming Soon)",
} as const;

export type LegacyExperimentTaskType = keyof typeof LEGACY_EXPERIMENT_TASK_TYPES;

export const isLegacyOnlineEvaluationWorkbenchState = (workbenchState: unknown): boolean => {
  if (!workbenchState || typeof workbenchState !== "object" || Array.isArray(workbenchState)) {
    return false;
  }

  return (workbenchState as Record<string, unknown>).task === "real_time";
};
