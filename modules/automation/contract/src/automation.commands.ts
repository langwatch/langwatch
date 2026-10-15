import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { AutomationAction, AutomationKind } from "./automation.ts";
import { triggerActionSchema, triggerKindSchema } from "./trigger.ts";

const jsonObjectSchema = z.record(z.string(), z.unknown());

const createAutomationCommandSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    action: triggerActionSchema,
    kind: triggerKindSchema.optional(),
    actionParams: jsonObjectSchema.optional(),
    filters: jsonObjectSchema.optional(),
    message: z.string().nullable().optional(),
  })
  .strict();
export interface CreateAutomationCommandSchema extends Named<
  typeof createAutomationCommandSchemaDefinition
> {}
export const createAutomationCommandSchema: CreateAutomationCommandSchema =
  createAutomationCommandSchemaDefinition;
export type CreateAutomationCommand = z.infer<typeof createAutomationCommandSchema> & {
  action: AutomationAction;
  kind?: AutomationKind;
};

const updateAutomationCommandSchemaDefinition = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1).optional(),
    active: z.boolean().optional(),
    action: triggerActionSchema.optional(),
    actionParams: jsonObjectSchema.optional(),
    filters: jsonObjectSchema.optional(),
    message: z.string().nullable().optional(),
  })
  .strict();
export interface UpdateAutomationCommandSchema extends Named<
  typeof updateAutomationCommandSchemaDefinition
> {}
export const updateAutomationCommandSchema: UpdateAutomationCommandSchema =
  updateAutomationCommandSchemaDefinition;
export type UpdateAutomationCommand = z.infer<typeof updateAutomationCommandSchema> & {
  action?: AutomationAction;
};

const suppressEmailCommandSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    email: z.string().min(1),
    triggerId: z.string().min(1).nullable(),
    reason: z.string().min(1).optional(),
  })
  .strict();
export interface SuppressEmailCommandSchema extends Named<
  typeof suppressEmailCommandSchemaDefinition
> {}
export const suppressEmailCommandSchema: SuppressEmailCommandSchema =
  suppressEmailCommandSchemaDefinition;
export type SuppressEmailCommand = z.infer<typeof suppressEmailCommandSchema>;
