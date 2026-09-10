import type { TraceEditOverlayRepository } from "./trace-edit-overlay.repository.ts";

/**
 * The rows the trace module owns through Postgres, chosen once at boot. The
 * canonical span and analytics rows live in ClickHouse behind their own
 * per-capability repositories; this bundle is only the Postgres-backed
 * reviewer correction, the one row this module keeps outside ClickHouse.
 */
export interface TraceRepositories {
  readonly editOverlay: TraceEditOverlayRepository;
}
