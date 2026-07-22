/**
 * What a tenant-scoped SSE broadcast can announce.
 *
 * Lives in the domain layer because event-sourcing reactors name it while
 * publishing, and they must not import `app-layer` (ADR-063).
 */
export type BroadcastEventType =
  | "trace_updated"
  | "simulation_updated"
  | "export_progress"
  | "presence_updated"
  | "presence_cursor"
  | "discover_updated"
  | "langy_conversation_updated";

/**
 * The slice of the broadcast service that event-sourcing uses: one method.
 *
 * `BroadcastService` satisfies this structurally, so the composition root keeps
 * passing the real service and nothing declares an `implements`.
 */
export interface BroadcastPort {
  broadcastToTenant(
    tenantId: string,
    event: string,
    eventType?: BroadcastEventType,
  ): Promise<void>;
}
