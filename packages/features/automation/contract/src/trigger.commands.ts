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
