/** One trace's per-role cost and latency, derived from its stored spans. */
export interface ScenarioRoleMetrics {
  scenarioRoleCosts: Record<string, number>;
  scenarioRoleLatencies: Record<string, number>;
}

export interface ScenarioRoleMetricsInput {
  tenantId: string;
  traceId: string;
  /** The trace's earliest span time: a partition hint, never a freshness cutoff. */
  occurredAtMs?: number;
  /** The fold's span count. A derivation is reused only within one fold version. */
  foldVersion?: number;
}
