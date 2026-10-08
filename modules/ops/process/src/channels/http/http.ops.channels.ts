import type { OpsChannels } from "../ops.channels.ts";
import { HttpCheckupProbeChannel } from "./http.checkup-probe.channel.ts";
import { HttpUsageReportChannel } from "./http.usage-report.channel.ts";

/** The usage report and the checkup's probes go over HTTP to hosts ops does not own. */
export class HttpOpsChannels {
  static readonly requires = [] as const;

  static create(): OpsChannels {
    return {
      usageReport: HttpUsageReportChannel.create(),
      probes: HttpCheckupProbeChannel.create(),
    };
  }
}
