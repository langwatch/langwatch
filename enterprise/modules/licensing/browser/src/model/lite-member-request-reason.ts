/**
 * What a Lite Member was trying to do, in the words an admin reads on their seat request,
 * from the permission resource the server refused (`evaluations:manage` names `evaluations`).
 */
const REASON_BY_RESOURCE: Readonly<Record<string, string>> = {
  evaluations: "run and save experiments",
  experiments: "run and save experiments",
  prompts: "save prompts",
  datasets: "edit datasets",
  workflows: "build workflows",
  scenarios: "run scenarios",
  annotations: "annotate traces",
  triggers: "set up automations",
  project: "change project settings",
  analytics: "edit dashboards",
};

export const GENERIC_REQUEST_REASON = "use this feature";

export function liteMemberRequestReason(resource: string | undefined): string {
  return (resource && REASON_BY_RESOURCE[resource]) || GENERIC_REQUEST_REASON;
}
