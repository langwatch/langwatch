import { z } from "zod";

export const AUTHZ_AGGREGATE_READ_EVENT_TYPE = "lw.authz.aggregate_read" as const;

/**
 * One user's read of an aggregate project through its shared grants (ADR-177 decision 9): who, in
 * which organization, of which aggregate, and when. Never the member read or the trace opened.
 */
export const authzAggregateReadEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  aggregateProjectId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type AuthzAggregateReadEventData = z.infer<typeof authzAggregateReadEventDataSchema>;
