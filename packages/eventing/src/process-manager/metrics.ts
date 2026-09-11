import { observableGauge } from "@langwatch/observability/metrics";
import { nowInstant } from "@langwatch/time";

/**
 * Fleet-level process-manager gauges (phase 3 of
 * dev/docs/plans/ops-process-manager-visibility-plan.md): the same trouble counts
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
  "pm_fleet_collection_success",
  "pm_fleet_last_success_timestamp_seconds",
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
 * six aggregate queries. In-flight reads are shared, and one read serves ten
 * seconds — including a failed attempt, so a database that is down is not
 * re-queried once per gauge. Freshness advances only after a successful read.
 */
let cached: {
  at: number;
  rows: ProcessFleetMetricsRow[];
  success: boolean;
} | null = null;
let lastSuccessAt = 0;
let inFlight: Promise<ProcessFleetMetricsRow[]> | null = null;
const CACHE_TTL_MS = 10_000;

async function readCounts(): Promise<ProcessFleetMetricsRow[]> {
  const read = readFleet;
  if (!read) return [];
  if (cached && nowInstant().epochMilliseconds - cached.at < CACHE_TTL_MS) return cached.rows;
  if (inFlight !== null) return inFlight;
  inFlight = Promise.resolve()
    .then(read)
    .then((rows) => {
      lastSuccessAt = nowInstant().epochMilliseconds;
      cached = { at: lastSuccessAt, rows, success: true };
      return rows;
    })
    .catch(() => {
      // Retain unresolved work, but never advance its freshness on failure.
      const rows = cached?.rows ?? [];
      cached = { at: nowInstant().epochMilliseconds, rows, success: false };
      return rows;
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
  lastSuccessAt = 0;
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

/**
 * Whether the latest fleet read succeeded, and when one last did.
 *
 * Not observing is how "no source bound" is said here: an observable gauge
 * that skips an interval is simply absent, which is what the `remove()` of the
 * `collect()` shape these replace meant. The freshness stamp is separate from
 * the success flag on purpose — a read that has failed for an hour still
 * reports success=0, and only the timestamp says how long it has been wrong.
 */
observableGauge(
  {
    name: "pm_fleet_collection_success",
    description:
      "Whether the latest process fleet database collection succeeded. Absent when this process has no source bound.",
  },
  async (observer) => {
    await readCounts();
    if (!readFleet) return;
    observer.observe(cached?.success ? 1 : 0);
  },
);

observableGauge(
  {
    name: "pm_fleet_last_success_timestamp_seconds",
    description:
      "Unix timestamp of the last successful process fleet database collection, or zero before the first success.",
  },
  async (observer) => {
    await readCounts();
    if (!readFleet) return;
    observer.observe(lastSuccessAt / 1000);
  },
);
