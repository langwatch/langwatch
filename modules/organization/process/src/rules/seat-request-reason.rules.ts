/**
 * The words admins read for what a member was trying to do (seat-requests.feature, member asks).
 * Only these words reach a mail or a push: the member names a fixed reason, never the text.
 */
import { type SeatRequestReason, seatRequestReasonSchema } from "@langwatch/organization-contract";

const WORDING: Readonly<Record<SeatRequestReason, string>> = {
  run_experiments: "run and save experiments",
  save_prompts: "save prompts",
  edit_datasets: "edit datasets",
  build_workflows: "build workflows",
  run_scenarios: "run scenarios",
  annotate_traces: "annotate traces",
  set_up_automations: "set up automations",
  change_project_settings: "change project settings",
  edit_dashboards: "edit dashboards",
  add_to_workspace: "add to their workspace",
  use_feature: "use this feature",
};

/**
 * The words for a stored reason. A row written before the reasons were fixed holds free text:
 * it reads as its fixed reason when the words match one, else as the generic one.
 */
export function seatRequestReasonWords(stored: string): string {
  const parsed = seatRequestReasonSchema.safeParse(stored);
  if (parsed.success) return WORDING[parsed.data];
  const matching = Object.values(WORDING).find((words) => words === stored.trim().toLowerCase());
  return matching ?? WORDING.use_feature;
}
