/**
 * What the reader's role lets them do on the workbench, and the refusals that
 * name the role, not the request, as the reason.
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

/** The grant that saves the workbench (`saveEvaluationsV3`). */
export const WORKBENCH_SAVE_PERMISSION = "experiments:update";

/** The grant that runs the workbench (`/api/experiments/execute`). */
export const WORKBENCH_RUN_PERMISSION = "evaluations:manage";

export type WorkbenchAccess = { maySave: boolean; mayRun: boolean };

/** Refusal codes whose reason is the reader's role or seat. */
const ACCESS_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "lite_member_restricted",
  "developer_seat_restricted",
  "permission_denied",
  "project_permission_denied",
]);

/** Whether a failed call was refused because of who is asking. */
export function isAccessRefusal(error: unknown): boolean {
  const code = readHandledError(error)?.code;
  return code !== undefined && ACCESS_REFUSAL_CODES.has(code);
}

/** The notice for a role missing a workbench grant, naming only what it leaves out. */
export function viewOnlyNotice({ maySave, mayRun }: WorkbenchAccess): string {
  const ask = "Ask an organization admin for access.";
  if (maySave) return `You can edit this experiment, but your role can't run evaluations. ${ask}`;
  const missing = mayRun ? "save changes" : "save or run experiments";
  return `You can view this experiment, but not change it. Your role can't ${missing}, so edits you make here stay in this tab. ${ask}`;
}

export const RUN_NOT_ALLOWED_TITLE = "Your role can't run evaluations";

export const RUN_NOT_ALLOWED_HINT =
  "Your role can't run evaluations. Ask an organization admin for access.";
