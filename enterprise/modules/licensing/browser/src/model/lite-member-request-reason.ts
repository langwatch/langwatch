/**
 * What a Lite Member was trying to do, as the fixed seat request reason the server words for
 * admins, from the permission resource refused (`evaluations:manage` names `evaluations`).
 */
import type { RequestAccessProps } from "@langwatch/organization-client";

type SeatRequestReason = NonNullable<RequestAccessProps["reason"]>;

const REASON_BY_RESOURCE: Readonly<Record<string, SeatRequestReason>> = {
  evaluations: "run_experiments",
  experiments: "run_experiments",
  prompts: "save_prompts",
  datasets: "edit_datasets",
  workflows: "build_workflows",
  scenarios: "run_scenarios",
  annotations: "annotate_traces",
  triggers: "set_up_automations",
  project: "change_project_settings",
  analytics: "edit_dashboards",
};

export const GENERIC_REQUEST_REASON: SeatRequestReason = "use_feature";

export function liteMemberRequestReason(resource: string | undefined): SeatRequestReason {
  return (resource && REASON_BY_RESOURCE[resource]) || GENERIC_REQUEST_REASON;
}
