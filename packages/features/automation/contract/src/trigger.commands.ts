import { z } from "zod";
import { alertTypeSchema, triggerActionSchema, triggerKindSchema } from "./trigger";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const createTriggerCommandSchema = z
  .object({
    id: z.string().min(1).optional(),
    projectId: z.string().min(1),
    name: z.string().min(1),
    action: triggerActionSchema,
    triggerKind: triggerKindSchema.optional(),
    actionParams: jsonObjectSchema,
    filters: jsonObjectSchema.optional(),
    filterQuery: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    alertType: alertTypeSchema.nullable().optional(),
    customGraphId: z.string().min(1).nullable().optional(),
    notificationCadence: z.string().optional(),
    traceDebounceMs: z.number().int().nonnegative().optional(),
    lastRunAt: z.date().nullable().optional(),
    slackTemplateType: z.string().nullable().optional(),
    slackTemplate: z.string().nullable().optional(),
    emailSubjectTemplate: z.string().nullable().optional(),
    emailBodyTemplate: z.string().nullable().optional(),
  })
  .strict();
export type CreateTriggerCommand = z.infer<typeof createTriggerCommandSchema>;

export const updateTriggerCommandSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1).optional(),
    // An edit may change WHAT an automation is, not only how it is configured:
    // the drawer converts a trace automation into a report, a report into a
    // graph alert, and back. All three keys travel on every save the drawer
    // makes, so a strict schema without them rejects the edit outright —
    // `unrecognized_keys`, on a channel that has no handled shape, which is a
    // 500 the author reads as "unknown error". Releasing the graph on a
    // conversion is why `customGraphId` must accept null.
    action: triggerActionSchema.optional(),
    triggerKind: triggerKindSchema.optional(),
    customGraphId: z.string().min(1).nullable().optional(),
    active: z.boolean().optional(),
    deleted: z.boolean().optional(),
    message: z.string().nullable().optional(),
    actionParams: jsonObjectSchema.optional(),
    filters: jsonObjectSchema.optional(),
    filterQuery: z.string().nullable().optional(),
    alertType: alertTypeSchema.nullable().optional(),
    notificationCadence: z.string().optional(),
    traceDebounceMs: z.number().int().nonnegative().optional(),
    lastRunAt: z.date().nullable().optional(),
    pausedReason: z.string().nullable().optional(),
    pausedAt: z.date().nullable().optional(),
    slackTemplateType: z.string().nullable().optional(),
    slackTemplate: z.string().nullable().optional(),
    emailSubjectTemplate: z.string().nullable().optional(),
    emailBodyTemplate: z.string().nullable().optional(),
  })
  .strict();
export type UpdateTriggerCommand = z.infer<typeof updateTriggerCommandSchema>;
