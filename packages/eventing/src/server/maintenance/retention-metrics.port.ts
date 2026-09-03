/** The three process-manager row families the retention sweep reaps. */
export type RetentionFamily = "dispatched_outbox" | "dead_outbox" | "inbox";

/**
 * Retention counters, injected rather than defined here.
 *
 * The counter names are load-bearing for dashboards and alerts, and the
 * process that owns the Prometheus registry is the process that must own the
 * definitions. A module-level counter defined here would be silently detached
 * the moment another module in the same process re-registered the same name,
 * and the sweep would go on running while its metrics stopped moving — the
 * exact failure this sweep exists to make visible.
 */
export abstract class ProcessRetentionMetricsPort {
  abstract recordSweptRows(family: RetentionFamily, rows: number): void;

  abstract recordFailure(family: RetentionFamily): void;
}
