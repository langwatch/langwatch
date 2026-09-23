/** A self-hosted install as the Backoffice reads it (ADR-156, section 10).
 * Declared here, not derived from `RouterOutputs`: model stays pure and
 * behavior depends on it, never the reverse. */
export interface SelfHostedInstance {
  id: string;
  instanceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: string | null;
  reportSchemaVersion: number | null;
  organizationId: string | null;
  issuedLicenseId: string | null;
  userEmailDomains: Record<string, number> | null;
  latestReport: Record<string, unknown> | null;
  optionalMetricsReported: boolean;
  hostnameReported: boolean;
  reportCount: number;
  lastUnknownFields: number;
  raisedSignals: string[];
  organizationName: string | null;
  activity: "reporting" | "quiet" | "gone";
}

export interface SelfHostedReportSummary {
  id: string;
  receivedAt: string;
  version: string | null;
  unknownFields: number;
}

/** What each activity state says, in the words an operator reads. */
export const ACTIVITY_LABELS: Record<SelfHostedInstance["activity"], string> = {
  reporting: "reporting",
  quiet: "quiet",
  gone: "gone",
};

export const ACTIVITY_COLORS: Record<SelfHostedInstance["activity"], string> = {
  reporting: "green",
  quiet: "yellow",
  gone: "gray",
};

/**
 * The rungs of getting started, in the order an install climbs them, with
 * the report field each is carried under. The order is the product's, not
 * the dictionary's: it lists a path a customer walks, not fields for docs.
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

/** A string field a report carried, or null when it carried none. */
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
    .toSorted((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}
