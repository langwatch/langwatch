import type { BugReport } from "@langwatch/ops-contract";

/** Team alert for a filed report. Best-effort: intake already succeeded. */
export abstract class BugReportNotifierPort {
  abstract notify(input: { report: BugReport }): Promise<void>;
}

/** A notifier for a deployment that alerts nowhere. */
export class SilentBugReportNotifier extends BugReportNotifierPort {
  async notify(): Promise<void> {}
}
