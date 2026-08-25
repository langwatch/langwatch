import { z } from "zod";
import type { AutomationAction, AutomationKind } from "./automation";
import { triggerActionSchema, triggerKindSchema } from "./trigger";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const createAutomationCommandSchema = z.object({
	projectId: z.string().min(1),
	name: z.string().min(1),
	action: triggerActionSchema,
	kind: triggerKindSchema.optional(),
	actionParams: jsonObjectSchema.optional(),
	filters: jsonObjectSchema.optional(),
	message: z.string().nullable().optional(),
}).strict();
export type CreateAutomationCommand = z.infer<typeof createAutomationCommandSchema> & { action: AutomationAction; kind?: AutomationKind };

export const updateAutomationCommandSchema = z.object({
	id: z.string().min(1),
	projectId: z.string().min(1),
	name: z.string().min(1).optional(),
	active: z.boolean().optional(),
	action: triggerActionSchema.optional(),
	actionParams: jsonObjectSchema.optional(),
	filters: jsonObjectSchema.optional(),
	message: z.string().nullable().optional(),
}).strict();
export type UpdateAutomationCommand = z.infer<typeof updateAutomationCommandSchema> & { action?: AutomationAction };

export const suppressEmailCommandSchema = z.object({
	projectId: z.string().min(1),
	email: z.string().min(1),
	triggerId: z.string().min(1).nullable(),
	reason: z.string().min(1).optional(),
}).strict();
export type SuppressEmailCommand = z.infer<typeof suppressEmailCommandSchema>;
