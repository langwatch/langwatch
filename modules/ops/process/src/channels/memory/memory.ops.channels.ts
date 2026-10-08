import type { OpsChannels } from "../ops.channels.ts";
import { MemoryBugReportNotifierChannel } from "./memory.bug-report-notifier.channel.ts";
import { MemoryCheckupProbeChannel } from "./memory.checkup-probe.channel.ts";
import { MemoryUsageReportChannel } from "./memory.usage-report.channel.ts";

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
