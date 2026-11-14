import { aggregateDiscoverySchema, aggregateSearchResultSchema } from "@langwatch/ops-contract";
import { z } from "zod";

/** How long a search and its matches are kept: the screen reads them within seconds. */
export const OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS = 600;

/** The replay wizard's aggregate count by its id: its bounds while pending, then the counts. */
const aggregateDiscoveryRecordSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    read: z.literal("discovery"),
    projectionNames: z.array(z.string()),
    since: z.string(),
    tenantIds: z.array(z.string()),
  }),
  z.object({
    status: z.literal("done"),
    read: z.literal("discovery"),
    discovery: aggregateDiscoverySchema,
  }),
]);

/** One search by its id: its bounds while pending, then the matches or the failure. */
const aggregateSearchRecordSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    query: z.string(),
    tenantIds: z.array(z.string()),
    sinceMs: z.number(),
  }),
  z.object({ status: z.literal("done"), results: z.array(aggregateSearchResultSchema) }),
  z.object({ status: z.literal("failed") }),
]);

/** A count names its read; a search predates the field, so it names none. */
export const opsEventLogSearchRecordSchema = z.union([
  aggregateDiscoveryRecordSchema,
  aggregateSearchRecordSchema,
]);
export type OpsEventLogSearchRecord = z.infer<typeof opsEventLogSearchRecordSchema>;

/** The searches the api accepted and the worker answered, each expiring by itself. */
export abstract class OpsEventLogSearchResultsRepository {
  abstract save(input: { requestId: string; record: OpsEventLogSearchRecord }): Promise<void>;
  /** The search's record, or none when it is unknown or expired. */
  abstract findByRequestId(input: { requestId: string }): Promise<OpsEventLogSearchRecord[]>;
}
