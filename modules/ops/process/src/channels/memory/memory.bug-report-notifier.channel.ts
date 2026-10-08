import type { BugReport } from "@langwatch/ops-contract";

import type { BugReportNotifier } from "../../app/ops.app.ts";

/** The bug-report alert in memory: every report is kept and nothing reaches Slack. */
export class MemoryBugReportNotifierChannel implements BugReportNotifier {
  readonly reports: BugReport[] = [];

  private constructor() {}

  static create(): MemoryBugReportNotifierChannel {
    return new MemoryBugReportNotifierChannel();
  }

  async notify({ report }: { report: BugReport }): Promise<void> {
    this.reports.push(report);
  }
}
