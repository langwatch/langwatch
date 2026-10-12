import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A project's trace milestones, recorded by trace and reacted to by peers from their side (§9). */
export const FIRST_TRACE_RECORDED_EVENT_TYPE = "lw.trace.first_trace_recorded" as const;
export const TRACE_RECEIVED_EVENT_TYPE = "lw.trace.trace_received" as const;

/** The project's first real trace, against the org admin, with the SDK it came from. */
const firstTraceRecordedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** The organization's admin when recorded, as `resolveOrgAdmin` picks it. */
  userId: z.string().min(1),
  sdkLanguage: z.string(),
  sdkFramework: z.string(),
  occurredAt: z.number().int().nonnegative(),
  /** When the organization was created, epoch ms; for days since signup. */
  organizationCreatedAt: z.number().int().nonnegative().nullish(),
  /** Which onboarding the organization went through; a string, so no new dependency. */
  onboardingVariant: z.string().nullish(),
});
export interface FirstTraceRecordedEventDataSchema extends Named<
  typeof firstTraceRecordedEventDataSchemaDefinition
> {}
export const firstTraceRecordedEventDataSchema: FirstTraceRecordedEventDataSchema =
  firstTraceRecordedEventDataSchemaDefinition;
export type FirstTraceRecordedEventData = z.infer<typeof firstTraceRecordedEventDataSchema>;

/** A later real trace on a project that already sent its first; `occurredAt` is the trace's. */
const traceReceivedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** The organization's admin when recorded. */
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** When the organization was created, epoch ms; for days since signup. */
  organizationCreatedAt: z.number().int().nonnegative().nullish(),
  /** Which onboarding the organization went through; a string, so no new dependency. */
  onboardingVariant: z.string().nullish(),
});
export interface TraceReceivedEventDataSchema extends Named<
  typeof traceReceivedEventDataSchemaDefinition
> {}
export const traceReceivedEventDataSchema: TraceReceivedEventDataSchema =
  traceReceivedEventDataSchemaDefinition;
export type TraceReceivedEventData = z.infer<typeof traceReceivedEventDataSchema>;

/** A page of a project's trace ids first seen in a month, sent by trace's upgrade step. */
export const MONTH_TRACE_IDS_LISTED_EVENT_TYPE = "lw.trace.month_trace_ids_listed" as const;
/** The most trace ids one listing event carries. */
export const MONTH_TRACE_IDS_PAGE_SIZE = 5_000;

const monthTraceIdsListedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** `YYYY-MM`, the UTC month the traces' summaries were first written in. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  traceIds: z.array(z.string().min(1)).min(1).max(MONTH_TRACE_IDS_PAGE_SIZE),
});
export interface MonthTraceIdsListedEventDataSchema extends Named<
  typeof monthTraceIdsListedEventDataSchemaDefinition
> {}
export const monthTraceIdsListedEventDataSchema: MonthTraceIdsListedEventDataSchema =
  monthTraceIdsListedEventDataSchemaDefinition;
export type MonthTraceIdsListedEventData = z.infer<typeof monthTraceIdsListedEventDataSchema>;
