import { definePipeline } from "../../";
import type { Event } from "../../domain/types";
import { SweepOrphansForTenantCommand } from "./commands/sweepOrphansForTenant.command";
import type { SweepOrphansForTenantCommandData } from "./schemas/commands";

export const ORPHAN_SWEEP_PROCESSING_PIPELINE_NAME = "orphan_sweep_processing" as const;

/** 6h cadence between sweep increments (single self-dispatch delay). */
export const ORPHAN_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEDUP_TTL_MS = ORPHAN_SWEEP_INTERVAL_MS + 10 * 60 * 1000;

export interface OrphanSweepProcessingPipelineDeps {
  sweepOrphansForTenantCommand: SweepOrphansForTenantCommand;
}

/**
 * Creates the orphan-sweep-processing pipeline definition.
 *
 * Command-only pipeline — no projections, no reactors.
 * The reactor that dispatches commands is registered in the EventSourcing
 * constructor alongside the global fold and map projections.
 */
export function createOrphanSweepProcessingPipeline(
  deps: OrphanSweepProcessingPipelineDeps,
) {
  return definePipeline<Event>()
    .withName(ORPHAN_SWEEP_PROCESSING_PIPELINE_NAME)
    .withAggregateType("orphan_sweep")
    .withCommandInstance(
      "sweepOrphansForTenant",
      SweepOrphansForTenantCommand,
      deps.sweepOrphansForTenantCommand,
      {
        delay: ORPHAN_SWEEP_INTERVAL_MS,
        deduplication: {
          makeId: (p: SweepOrphansForTenantCommandData) => p.tenantId,
          ttlMs: DEDUP_TTL_MS,
        },
      },
    )
    .build();
}
