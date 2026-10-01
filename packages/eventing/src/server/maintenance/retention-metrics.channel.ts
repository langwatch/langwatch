/** The three process-manager row families the retention sweep reaps. */
export type RetentionFamily = "dispatched_outbox" | "dead_outbox" | "inbox";

/**
 * Retention counters are injected, not defined here; registry ownership
 * prevents silent detachment of metrics when the same name is re-registered.
 */
export abstract class ProcessRetentionMetrics {
  abstract recordSweptRows(family: RetentionFamily, rows: number): void;

  abstract recordFailure(family: RetentionFamily): void;
}
