import { HttpUsageReportChannel } from "./http/http.usage-report.channel.ts";
import { MemoryUsageReportChannel } from "./memory/memory.usage-report.channel.ts";

/** Where the daily usage report is posted. */
export const usageReportChannels = {
  live: HttpUsageReportChannel,
  memory: MemoryUsageReportChannel,
};
