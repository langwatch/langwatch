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
 * report field each is carried under.
 *
 * The order is the product's, not the dictionary's: the dictionary lists
 * fields for a docs page, and this lists them as a path a customer walks.
 */
export const ONBOARDING_LADDER: readonly { field: string; label: string }[] = [
  { field: "first_project_at", label: "Created a project" },
  { field: "first_member_at", label: "Added a second member" },
  { field: "first_model_provider_at", label: "Configured a model provider" },
  { field: "first_prompt_at", label: "Created a prompt" },
  { field: "first_dataset_at", label: "Created a dataset" },
  { field: "first_evaluation_at", label: "Ran an evaluation" },
  { field: "first_monitor_at", label: "Set up a monitor" },
  { field: "first_annotation_at", label: "Left an annotation" },
  { field: "first_workflow_at", label: "Built a workflow" },
  { field: "first_trigger_at", label: "Added a trigger" },
  { field: "first_experiment_at", label: "Ran an experiment" },
];

/** The usage numbers the drawer shows, and what to call them. */
export const USAGE_ROWS: readonly { field: string; label: string }[] = [
  { field: "totalTraces", label: "Traces" },
  { field: "traces_7d", label: "Traces, last 7 days" },
  { field: "traces_28d", label: "Traces, last 28 days" },
  { field: "totalScenarioEvents", label: "Scenario events" },
  { field: "scenario_runs_28d", label: "Scenario runs, last 28 days" },
  { field: "prompts", label: "Prompts" },
  { field: "prompts_28d", label: "Prompts, last 28 days" },
  { field: "datasets", label: "Datasets" },
  { field: "batchEvaluations", label: "Evaluations" },
  { field: "batch_evaluations_28d", label: "Evaluations, last 28 days" },
  { field: "monitors", label: "Monitors" },
  { field: "workflows", label: "Workflows" },
  { field: "annotations", label: "Annotations" },
  { field: "active_users_28d", label: "Active users, last 28 days" },
  { field: "active_projects_28d", label: "Active projects, last 28 days" },
];

/** A number a report carried, or null when it carried none. */
export function reportNumber(
  report: SelfHostedInstance["latestReport"],
  field: string,
): number | null {
  const value = report?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A string field a report carried, or null when it carried none. Dates come
 * back as the string the report sent, so the ladder reads them through here
 * too.
 */
export function reportText(
  report: SelfHostedInstance["latestReport"],
  field: string,
): string | null {
  const value = report?.[field];
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
