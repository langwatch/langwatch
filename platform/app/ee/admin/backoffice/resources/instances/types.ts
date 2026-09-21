import type { RouterOutputs } from "~/utils/api";

export type SelfHostedInstance =
  RouterOutputs["selfHostedInstances"]["getAll"]["instances"][number];

export type InstanceActivity = SelfHostedInstance["activity"];

/** What each activity state says, in the words an operator reads. */
export const ACTIVITY_LABELS: Record<InstanceActivity, string> = {
  reporting: "reporting",
  quiet: "quiet",
  gone: "gone",
};

export const ACTIVITY_COLORS: Record<InstanceActivity, string> = {
  reporting: "green",
  quiet: "yellow",
  gone: "gray",
};

/**
 * The rungs of getting started, in the order an install climbs them, with the
 * report key each is carried under.
 *
 * The order is the product's, not the dictionary's: the dictionary lists
 * fields for a docs page, and this lists them as a path a customer walks.
 */
export const ONBOARDING_LADDER: readonly { key: string; label: string }[] = [
  { key: "first_project_at", label: "Created a project" },
  { key: "first_member_at", label: "Added a second member" },
  { key: "first_model_provider_at", label: "Configured a model provider" },
  { key: "first_prompt_at", label: "Created a prompt" },
  { key: "first_dataset_at", label: "Created a dataset" },
  { key: "first_evaluation_at", label: "Ran an evaluation" },
  { key: "first_monitor_at", label: "Set up a monitor" },
  { key: "first_annotation_at", label: "Left an annotation" },
  { key: "first_workflow_at", label: "Built a workflow" },
  { key: "first_trigger_at", label: "Added a trigger" },
  { key: "first_experiment_at", label: "Ran an experiment" },
];

/** The usage numbers the drawer shows, and what to call them. */
export const USAGE_ROWS: readonly { key: string; label: string }[] = [
  { key: "totalTraces", label: "Traces" },
  { key: "traces_7d", label: "Traces, last 7 days" },
  { key: "traces_28d", label: "Traces, last 28 days" },
  { key: "totalScenarioEvents", label: "Scenario events" },
  { key: "scenario_runs_28d", label: "Scenario runs, last 28 days" },
  { key: "prompts", label: "Prompts" },
  { key: "prompts_28d", label: "Prompts, last 28 days" },
  { key: "datasets", label: "Datasets" },
  { key: "batchEvaluations", label: "Evaluations" },
  { key: "batch_evaluations_28d", label: "Evaluations, last 28 days" },
  { key: "monitors", label: "Monitors" },
  { key: "workflows", label: "Workflows" },
  { key: "annotations", label: "Annotations" },
  { key: "active_users_28d", label: "Active users, last 28 days" },
  { key: "active_projects_28d", label: "Active projects, last 28 days" },
];

/** A number a report carried, or null when it carried none. */
export function reportNumber(
  report: SelfHostedInstance["latestReport"],
  key: string,
): number | null {
  const value = report?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A date a report carried, or null when the rung was never reached. */
export function reportDate(
  report: SelfHostedInstance["latestReport"],
  key: string,
): string | null {
  const value = report?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A string a report carried, or null. */
export function reportText(
  report: SelfHostedInstance["latestReport"],
  key: string,
): string | null {
  const value = report?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The domains an install reported, largest first. */
export function sortedDomains(
  domains: SelfHostedInstance["userEmailDomains"],
): { domain: string; count: number }[] {
  if (!domains) return [];
  return Object.entries(domains)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}
