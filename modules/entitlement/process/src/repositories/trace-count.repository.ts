import { z } from "zod";

/** The count's version; a stored row of another version reads as undecodable. */
export const TRACE_COUNT_PROJECTION_VERSION = "2026-10-11" as const;

/**
 * One project's traces in one UTC month, folded from trace's facts: the seeded base counted up to
 * the upgrade's cut, and every trace first seen since, by the hour it was first seen in.
 */
export const traceCountStateSchema = z.object({
  projectId: z.string(),
  /** `YYYY-MM`. */
  month: z.string(),
  seeded: z.object({ traces: z.number(), cutAt: z.number() }).nullable(),
  /** First sightings per UTC hour, keyed by the hour's first instant in epoch ms. */
  liveByHour: z.record(z.string(), z.number()),
  LastEventOccurredAt: z.number(),
});
export type TraceCountState = z.infer<typeof traceCountStateSchema>;

/** The stored count with the event ids its last write applied, for redelivery dedup. */
export type StoredTraceCount = Readonly<{
  state: TraceCountState;
  appliedEventIds: readonly string[];
}>;

/** The `usage_trace_count` table, keyed by organization so private instances keep their cluster. */
export abstract class TraceCountRepository {
  /** The project's month as last written; an absent row answers an empty list. */
  abstract find(input: {
    organizationId: string;
    projectId: string;
    month: string;
  }): Promise<StoredTraceCount[]>;
  /** Writes the project's month: the folded state, its total and the ids just applied. */
  abstract save(input: {
    organizationId: string;
    state: TraceCountState;
    traces: number;
    appliedEventIds: readonly string[];
  }): Promise<void>;
  /** Traces first seen in the month across the organization's projects. */
  abstract findTotal(input: { organizationId: string; month: string }): Promise<number>;
  /** {@link findTotal} per named project; a project with no trace is absent from the answer. */
  abstract countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<{ projectId: string; count: number }[]>;
}
