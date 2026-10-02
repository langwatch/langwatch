import { z } from "zod";

/** A project's trace milestones, recorded by trace and reacted to by peers from their side (§9). */
export const FIRST_TRACE_RECORDED_EVENT_TYPE = "lw.trace.first_trace_recorded" as const;
export const TRACE_RECEIVED_EVENT_TYPE = "lw.trace.trace_received" as const;

/** The project's first real trace, against the org admin, with the SDK it came from. */
export const firstTraceRecordedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** The organization's admin when recorded, as `resolveOrgAdmin` picks it. */
  userId: z.string().min(1),
  sdkLanguage: z.string(),
  sdkFramework: z.string(),
  occurredAt: z.number().int().nonnegative(),
});
export type FirstTraceRecordedEventData = z.infer<typeof firstTraceRecordedEventDataSchema>;

/** A later real trace on a project that already sent its first; `occurredAt` is the trace's. */
export const traceReceivedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** The organization's admin when recorded. */
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type TraceReceivedEventData = z.infer<typeof traceReceivedEventDataSchema>;
