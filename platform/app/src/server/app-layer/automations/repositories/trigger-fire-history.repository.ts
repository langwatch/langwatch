/**
 * Read-side repository over `TriggerSent` fire history, powering the
 * automations list metrics and the view drawer's "Recent fires" panel.
 * Write-side dedup (claimSend / graph-alert open rows) lives in
 * `trigger.repository.ts` — this surface is strictly read-only.
 */

/** Per-trigger rollup of the project's fire history. */
export interface TriggerFireStats {
  triggerId: string;
  /** Latest `TriggerSent.createdAt` for the trigger, null when it never fired. */
  lastFiredAt: Date | null;
  /** Count of fires with `createdAt >= firesSince` (the caller's window). */
  recentFireCount: number;
  /**
   * True when an unresolved graph-alert incident is open for the trigger
   * (a `TriggerSent` row with `customGraphId` set and `resolvedAt` null).
   * Always false for trace triggers — their rows are dedup claims, not
   * incidents, and never resolve.
   */
  currentlyFiring: boolean;
}

/**
 * A single `TriggerSent` row as shown in the view drawer's fire list.
 *
 * Deliberately metadata-only: no trace ids and no trace content. Fire
 * history is gated by `triggers:view`, which is weaker than the trace
 * protections surface (`canSeeCapturedInput` / `canSeeCapturedOutput` in
 * `~/server/traces/protections.ts`) — so nothing here may reference or
 * enumerate captured trace data.
 */
export interface TriggerFire {
  id: string;
  triggerId: string;
  customGraphId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface TriggerFireHistoryRepository {
  findAllStatsForProject(params: {
    projectId: string;
    firesSince: Date;
  }): Promise<TriggerFireStats[]>;

  findAllRecentByTriggerId(params: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<TriggerFire[]>;

  /**
   * Every trigger's recent fires across the project, newest first — the feed
   * behind "what have my automations actually been doing?". Same metadata-only
   * contract as `findAllRecentByTriggerId`: no trace ids, no trace content.
   */
  findAllRecentForProject(params: {
    projectId: string;
    limit: number;
  }): Promise<TriggerFire[]>;
}
