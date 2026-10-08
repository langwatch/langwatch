import type { FoldProjectionStore } from "@langwatch/eventing";
import { z } from "zod";

/** One topic as trace's fold keeps it: only what a facet label needs. */
export const traceTopicNameSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
});
export type TraceTopicName = z.infer<typeof traceTopicNameSchema>;

/** A project's live topics, folded from topic's `topics_recorded` fact. */
export const traceTopicNamesFoldStateSchema = z.object({
  topics: z.array(traceTopicNameSchema),
  LastEventOccurredAt: z.number(),
});
export type TraceTopicNamesFoldState = z.infer<typeof traceTopicNamesFoldStateSchema>;

/** The peer fold's version; a stored row of another version is re-folded from topic's log. */
export const TRACE_TOPIC_NAMES_PROJECTION_VERSION = "2026-10-08" as const;

/** The read over trace's folded topic names. Spec: modules/trace/specs/trace-topic-names.feature */
export abstract class TraceTopicNamesReadRepository {
  /** Names of the live topics among `ids`; a removed or unknown topic is absent from the map. */
  abstract findNamesByIds(args: { projectId: string; ids: string[] }): Promise<Map<string, string>>;
}

/** The peer fold's store and the read over the same rows. */
export type TraceTopicNamesRepository = FoldProjectionStore<TraceTopicNamesFoldState> &
  TraceTopicNamesReadRepository;
