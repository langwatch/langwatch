import { Gauge, register } from "prom-client";

/**
 * Fleet-level process-manager gauges (phase 3 of
 * dev/docs/ops-process-manager-visibility-plan.md): the same trouble counts
 * the /ops/processes page shows, exported so alerting can watch them without
 * a human on the page.
 *
 * Every value is a GLOBAL table count reported by every scraping pod — the
 * same shape as gq_blocked_groups — so dashboards and alerts must aggregate
 * with max() across pods, never sum().
 */
const metricNames = [
  "pm_instances",
  "pm_instances_overdue_wakes",
  "pm_outbox_pending",
  "pm_outbox_overdue_pending",
  "pm_outbox_lapsed_leases",
  "pm_outbox_dead",
] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

export interface ProcessFleetMetricsRow {
  processName: string;
  instances: number;
  overdueWakes: number;
  pendingMessages: number;
  overduePending: number;
  lapsedLeases: number;
  deadMessages: number;
}

type FleetReader = () => Promise<ProcessFleetMetricsRow[]>;

let readFleet: FleetReader | null = null;

/**
 * Scrape-time cache: six gauges collect on every scrape, and each must see
 * the same read rather than issuing six aggregate queries per scrape.
 * In-flight reads are shared; a settled read serves ten seconds.
 */
let cached: { at: number; rows: ProcessFleetMetricsRow[] } | null = null;
let inFlight: Promise<ProcessFleetMetricsRow[]> | null = null;
const CACHE_TTL_MS = 10_000;

async function readCounts(): Promise<ProcessFleetMetricsRow[]> {
  if (!readFleet) return [];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;
  if (inFlight !== null) return inFlight;
  inFlight = readFleet()
    .then((rows) => {
      cached = { at: Date.now(), rows };
      return rows;
    })
    .catch(() => {
      // A failed read reports nothing rather than stale numbers presented
      // as fresh; the scrape itself still succeeds.
      return cached?.rows ?? [];
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Wire the source the gauges read on scrape. Called once from the
 * composition root on processes that run the substrate; before it is called
 * the gauges report nothing.
 */
export function bindProcessFleetMetricsSource(read: FleetReader): void {
  readFleet = read;
  cached = null;
}

function fleetGauge(
  name: (typeof metricNames)[number],
  help: string,
  pick: (row: ProcessFleetMetricsRow) => number,
): Gauge {
  return new Gauge({
    name,
    help: `${help} Global count reported per pod — aggregate with max(), not sum().`,
    labelNames: ["process_name"],
    async collect() {
      const rows = await readCounts();
      this.reset();
      for (const row of rows) {
        this.set({ process_name: row.processName }, pick(row));
      }
    },
  });
}

export const pmInstances = fleetGauge(
  "pm_instances",
  "Process-manager instances per process name.",
  (r) => r.instances,
);
export const pmInstancesOverdueWakes = fleetGauge(
  "pm_instances_overdue_wakes",
  "Instances whose next wake is past due beyond the ops threshold.",
  (r) => r.overdueWakes,
);
export const pmOutboxPending = fleetGauge(
  "pm_outbox_pending",
  "Pending outbox messages per process name.",
  (r) => r.pendingMessages,
);
export const pmOutboxOverduePending = fleetGauge(
  "pm_outbox_overdue_pending",
  "Pending outbox messages long past their next attempt with no live lease.",
  (r) => r.overduePending,
);
export const pmOutboxLapsedLeases = fleetGauge(
  "pm_outbox_lapsed_leases",
  "Pending outbox messages whose dispatch lease expired (dispatcher died or still delivering).",
  (r) => r.lapsedLeases,
);
export const pmOutboxDead = fleetGauge(
  "pm_outbox_dead",
  "Dead outbox messages per process name — intents that will not happen until redriven.",
  (r) => r.deadMessages,
);
