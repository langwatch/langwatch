import { aggregateSearchResultSchema } from "@langwatch/ops-contract";
import { z } from "zod";

/** How long a search and its matches are kept: the screen reads them within seconds. */
export const OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS = 600;

/** One search by its id: its bounds while pending, then the matches or the failure. */
export const opsEventLogSearchRecordSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    query: z.string(),
    tenantIds: z.array(z.string()),
    sinceMs: z.number(),
  }),
  z.object({ status: z.literal("done"), results: z.array(aggregateSearchResultSchema) }),
  z.object({ status: z.literal("failed") }),
]);
export type OpsEventLogSearchRecord = z.infer<typeof opsEventLogSearchRecordSchema>;

/** The searches the api accepted and the worker answered, each expiring by itself. */
export abstract class OpsEventLogSearchResultsRepository {
  abstract save(input: { requestId: string; record: OpsEventLogSearchRecord }): Promise<void>;
  /** The search's record, or none when it is unknown or expired. */
  abstract findByRequestId(input: { requestId: string }): Promise<OpsEventLogSearchRecord[]>;
}
