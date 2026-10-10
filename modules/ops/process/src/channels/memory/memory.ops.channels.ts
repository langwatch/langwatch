import type { BugReport } from "@langwatch/ops-contract";

import type { BugReportNotifier } from "../../app/ops.app.ts";
import type { OpsChannels } from "../ops.channels.ts";
import { MemoryCheckupProbeChannel } from "./memory.checkup-probe.channel.ts";
import { MemoryUsageReportChannel } from "./memory.usage-report.channel.ts";

/** The bug-report alert in memory: every report is kept and nothing reaches Slack. */
class MemoryBugReportNotifierChannel implements BugReportNotifier {
  readonly reports: BugReport[] = [];

  private constructor() {}

  static create(): MemoryBugReportNotifierChannel {
    return new MemoryBugReportNotifierChannel();
  }

  async notify({ report }: { report: BugReport }): Promise<void> {
    this.reports.push(report);
  }
}

/** Reports, probes and alerts are held in-process; a memory install sends nothing over the wire. */
export class MemoryOpsChannels {
  static readonly requires = [] as const;

  static create(): OpsChannels {
    return {
      usageReport: MemoryUsageReportChannel.create(),
      probes: MemoryCheckupProbeChannel.create(),
      bugReportNotifier: MemoryBugReportNotifierChannel.create(),
    };
  }
}
