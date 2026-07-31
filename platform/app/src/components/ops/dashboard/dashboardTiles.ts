import { formatCount } from "~/components/ops/shared/formatters";
import type { DashboardData } from "~/server/app-layer/ops/types";

/**
 * One headline figure on the ops dashboard.
 *
 * `source` is not decoration: it is the snapshot field the tile reports, and it
 * is typed as a key of `DashboardData` so a tile cannot be written for a figure
 * the collector does not broadcast. That is the whole guard. The page used to
 * render throughput, latency and dead-letter tiles whose substrate had been
 * deleted; a `0` there is worse than no tile at all, because an operator reads
 * it at 3am and concludes the plane is healthy.
 *
 * Rates and latencies are deliberately absent. The dispatch plane reports them
 * through its `Metrics` port (ADR-108), which is a write-only counter and
 * histogram contract scraped by Prometheus — there is no read seam, and
 * deriving them from the Redis keyspace would mean inventing counters nothing
 * writes.
 */
export interface DashboardTile {
  label: string;
  source: keyof DashboardData;
  value: string;
  sublabel?: string;
  color?: string;
  testId: string;
}

function roundedMb(mb: number): string {
  return `${Math.round(mb)}MB`;
}

export function buildDashboardTiles(data: DashboardData): DashboardTile[] {
  return [
    {
      label: "Lanes",
      source: "totalLanes",
      value: formatCount(data.totalLanes),
      sublabel: "registered",
      testId: "total-lanes-stat",
    },
    {
      label: "Pending",
      source: "totalPendingJobs",
      value: formatCount(data.totalPendingJobs),
      sublabel: "jobs staged",
      testId: "pending-jobs-stat",
    },
    {
      label: "Leased",
      source: "leasedLanes",
      value: formatCount(data.leasedLanes),
      sublabel: "in flight",
      testId: "leased-lanes-stat",
    },
    {
      label: "Parked",
      source: "parkedLanes",
      value: formatCount(data.parkedLanes),
      sublabel: data.parkedLanes > 0 ? "needs an operator" : "none",
      color: data.parkedLanes > 0 ? "red.500" : undefined,
      testId: "parked-lanes-stat",
    },
    {
      label: "App CPU",
      source: "processCpuPercent",
      value: `${data.processCpuPercent}%`,
      sublabel: "this process",
      testId: "process-cpu-stat",
    },
    {
      label: "App memory",
      source: "processMemoryUsedMb",
      value: roundedMb(data.processMemoryUsedMb),
      sublabel: `rss of ${roundedMb(data.processMemoryTotalMb)} host`,
      testId: "process-memory-stat",
    },
  ];
}
