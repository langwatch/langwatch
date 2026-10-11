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

/** A trace's first span reached its summary: once per trace, the fact entitlement counts. */
export const TRACE_FIRST_SEEN_EVENT_TYPE = "lw.trace.trace_first_seen" as const;
/** The project's traces first seen in a month before a cut, recorded once by trace's upgrade. */
export const TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE = "lw.trace.traces_counted_before_cut" as const;

const traceFirstSeenEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  traceId: z.string().min(1),
  /** Epoch ms the trace's summary was first written: `trace_summaries.CreatedAt`. */
  firstSeenAt: z.number().int().nonnegative(),
});
export interface TraceFirstSeenEventDataSchema extends Named<
  typeof traceFirstSeenEventDataSchemaDefinition
> {}
export const traceFirstSeenEventDataSchema: TraceFirstSeenEventDataSchema =
  traceFirstSeenEventDataSchemaDefinition;
export type TraceFirstSeenEventData = z.infer<typeof traceFirstSeenEventDataSchema>;

const tracesCountedBeforeCutEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  /** `YYYY-MM`, the UTC month counted from its first instant. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /**
   * Epoch ms, the moment the old writers were gone. `traces` counts up to the first whole UTC
   * minute at or after it; later minutes arrive as {@link TRACE_FIRST_SEEN_EVENT_TYPE} facts.
   */
  cutAt: z.number().int().nonnegative(),
  traces: z.number().int().nonnegative(),
});
export interface TracesCountedBeforeCutEventDataSchema extends Named<
  typeof tracesCountedBeforeCutEventDataSchemaDefinition
> {}
export const tracesCountedBeforeCutEventDataSchema: TracesCountedBeforeCutEventDataSchema =
  tracesCountedBeforeCutEventDataSchemaDefinition;
export type TracesCountedBeforeCutEventData = z.infer<typeof tracesCountedBeforeCutEventDataSchema>;
