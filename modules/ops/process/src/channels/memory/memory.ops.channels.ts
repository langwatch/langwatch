import type { OpsChannels } from "../ops.channels.ts";
import { MemoryCheckupProbeChannel } from "./memory.checkup-probe.channel.ts";
import { MemoryUsageReportChannel } from "./memory.usage-report.channel.ts";

/** Reports and probes are held in-process, so a memory install sends nothing over the network. */
export class MemoryOpsChannels {
  static readonly requires = [] as const;

  static create(): OpsChannels {
    return {
      usageReport: MemoryUsageReportChannel.create(),
      probes: MemoryCheckupProbeChannel.create(),
    };
  }
}
