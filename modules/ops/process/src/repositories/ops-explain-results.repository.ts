import { opsExplainTypeSchema } from "@langwatch/ops-contract";
import { z } from "zod";

/** How long a request and its answer are kept: the operator tool polls within seconds. */
export const OPS_EXPLAIN_RESULT_TTL_SECONDS = 600;

/** One EXPLAIN request by its id: the wrapped query while pending, then the rows or the failure. */
export const opsExplainRecordSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), type: opsExplainTypeSchema, wrappedQuery: z.string() }),
  z.object({ status: z.literal("done"), type: opsExplainTypeSchema, rows: z.array(z.unknown()) }),
  z.object({ status: z.literal("failed"), reason: z.enum(["not_configured", "refused"]) }),
]);
export type OpsExplainRecord = z.infer<typeof opsExplainRecordSchema>;

/** The EXPLAIN requests the api accepted and the worker answered, each expiring by itself. */
export abstract class OpsExplainResultsRepository {
  abstract save(input: { requestId: string; record: OpsExplainRecord }): Promise<void>;
  /** The request's record, or none when it is unknown or expired. */
  abstract findByRequestId(input: { requestId: string }): Promise<OpsExplainRecord[]>;
}
