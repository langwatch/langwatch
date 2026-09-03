import { observableGauge } from "@langwatch/observability/metrics";

/**
 * Fleet-level process-manager gauges (phase 3 of
 * dev/docs/ops-process-manager-visibility-plan.md): the same trouble counts
 * the /ops/processes page shows, exported so alerting can watch them without
 * a human on the page.
 *
 * Every value is a GLOBAL table count reported by every pod — the same shape
 * as gq_blocked_groups — so dashboards and alerts must aggregate with max()
 * across pods, never sum().
 *
 * These are observable gauges: they are read on the exporter's interval
 * rather than written when something changes. Two differences from the
 * `prom-client` `collect()` they replace, both improvements:
 *
 *   - The read cadence is now fixed and known, instead of being whatever the
 *     scrapers were configured with multiplied by how many were watching.
 *   - A series that is not observed in an interval is simply absent. Under
 *     `collect()` a stale label combination lingered until something called
 *     `reset()`, which is why the old implementation had to.
 */

const metricNames = [
  "pm_instances",
  "pm_instances_overdue_wakes",
  "pm_outbox_pending",
  "pm_outbox_overdue_pending",
  "pm_outbox_lapsed_leases",
  "pm_outbox_dead",
] as const;

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
 * Collection-time cache: six gauges are observed within milliseconds of each
 * other on every export, and each must see the same read rather than issuing
 * six aggregate queries. In-flight reads are shared; a settled read serves ten
 * seconds, comfortably inside one export interval.
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
      // as fresh; the export itself still succeeds.
      return cached?.rows ?? [];
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Wire the source the gauges read on collection. Called once from the
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
): void {
  observableGauge(
    {
      name,
      description: `${help} Global count reported per pod — aggregate with max(), not sum().`,
    },
    async (observer) => {
      for (const row of await readCounts()) {
        observer.observe(pick(row), { process_name: row.processName });
      }
    },
  );
}

fleetGauge("pm_instances", "Process-manager instances per process name.", (r) => r.instances);
fleetGauge(
  "pm_instances_overdue_wakes",
  "Instances whose next wake is past due beyond the ops threshold.",
  (r) => r.overdueWakes,
);
fleetGauge(
  "pm_outbox_pending",
  "Pending outbox messages per process name.",
  (r) => r.pendingMessages,
);
fleetGauge(
  "pm_outbox_overdue_pending",
  "Pending outbox messages long past their next attempt with no live lease.",
  (r) => r.overduePending,
);
fleetGauge(
  "pm_outbox_lapsed_leases",
  "Pending outbox messages whose dispatch lease expired (dispatcher died or still delivering).",
  (r) => r.lapsedLeases,
);
fleetGauge(
  "pm_outbox_dead",
  "Dead outbox messages per process name — intents that will not happen until redriven.",
  (r) => r.deadMessages,
);
