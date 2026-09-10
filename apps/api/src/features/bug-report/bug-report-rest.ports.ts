/**
 * What `/api/bug-reports` reaches on this process. The intake's own behaviour
 * — the repository, the rate limiter, the notifier and the project lookup —
 * moved into the ops module's application; this door composes nothing of its
 * own any more.
 */
import type { OpsApi } from "@langwatch/ops-contract";

/** The operator application the intake answers from. */
export type BugReportRestPorts = Readonly<{
  ops: () => OpsApi;
}>;
