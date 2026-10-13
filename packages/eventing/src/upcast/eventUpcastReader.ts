import { z } from "zod";

import type { ReplayEventSource } from "../replay/replayEventSource.ts";
import { type PipelineUpcasts, upcastStepId } from "./eventUpcast.ts";

/** One declared upcast as ops and the migrations ledger read it. */
export const activeUpcastSchema = z.object({
  id: z.string(),
  pipeline: z.string(),
  from: z.string(),
  fromAggregateType: z.string().nullable(),
  to: z.string(),
  drainsFrom: z.string().nullable(),
  /** Stored events of the former type across every tenant; zero once a rewrite has run. */
  storedEvents: z.number().int().nonnegative(),
});
export type ActiveUpcast = z.infer<typeof activeUpcastSchema>;

/** The log's count by event type, across every tenant: the replay source already answers it. */
export type UpcastCoverageSource = Pick<ReplayEventSource, "countEventsForAggregates">;

/**
 * Which upcasts the registered pipelines declare and how many stored events each still covers
 * (Alex, 2026-10-06). Ops and the ledger read it; it never writes.
 * Spec: specs/event-upcast.feature.
 */
export class EventUpcastReader {
  static create(options: {
    upcasts: readonly PipelineUpcasts[];
    coverage: UpcastCoverageSource;
  }): EventUpcastReader {
    return new EventUpcastReader(options.upcasts, options.coverage);
  }

  private constructor(
    private readonly upcasts: readonly PipelineUpcasts[],
    private readonly coverage: UpcastCoverageSource,
  ) {}

  async findActiveUpcasts(): Promise<ActiveUpcast[]> {
    const declared = this.upcasts.flatMap((own) => own.events.map((upcast) => ({ own, upcast })));
    return Promise.all(
      declared.map(async ({ own, upcast }) => ({
        id: upcastStepId({ pipeline: own.pipeline, from: upcast.from.type }),
        pipeline: own.pipeline,
        from: upcast.from.type,
        fromAggregateType: upcast.from.aggregateType ?? null,
        to: upcast.to,
        drainsFrom: own.drain?.pipeline ?? null,
        storedEvents: await this.coverage.countEventsForAggregates({
          eventTypes: [upcast.from.type],
          sinceMs: 0,
        }),
      })),
    );
  }
}
