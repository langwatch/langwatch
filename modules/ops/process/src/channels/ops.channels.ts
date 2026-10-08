import type { CheckupProbeChannel } from "./checkup-probe.channel.ts";
import type { UsageReportChannel } from "./usage-report.channel.ts";

/** Every channel ops holds, as the container hands them to the module class. */
export interface OpsChannels {
  readonly usageReport: UsageReportChannel;
  readonly probes: CheckupProbeChannel;
}
