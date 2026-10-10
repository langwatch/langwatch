import type { Named } from "@langwatch/module";
import { z } from "zod";

import { agentInputBindingSchema, fieldSchema } from "../fields.ts";

const baseAgentConfigSchemaDefinition = z.object({
  _library_ref: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  cls: z.string().optional(),
  parameters: z.array(fieldSchema).optional(),
  inputs: z.array(fieldSchema).optional(),
  outputs: z.array(fieldSchema).optional(),
  isCustom: z.boolean().optional(),
  behave_as: z.literal("evaluator").optional(),
});
export interface BaseAgentConfigSchema extends Named<typeof baseAgentConfigSchemaDefinition> {}
export const baseAgentConfigSchema: BaseAgentConfigSchema = baseAgentConfigSchemaDefinition;

export type BaseAgentConfig = z.infer<typeof baseAgentConfigSchema>;

const codeParameterSchemaDefinition = z.object({
  identifier: z.literal("code"),
  type: z.literal("code"),
  value: z.string(),
  optional: z.boolean().optional(),
  desc: z.string().optional(),
  prefix: z.string().optional(),
  hidden: z.boolean().optional(),
});
export interface CodeParameterSchema extends Named<typeof codeParameterSchemaDefinition> {}
export const codeParameterSchema: CodeParameterSchema = codeParameterSchemaDefinition;

const codeAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  parameters: z
    .array(
      z.union([
        codeParameterSchema,
        fieldSchema.refine((field) => field.identifier !== "code", {
          message: "The code parameter must have type code and a string value.",
        }),
      ]),
    )
    .refine(
      (parameters) =>
        parameters.some(
          (parameter) => parameter.identifier === "code" && parameter.type === "code",
        ),
      "Code agent config requires a code parameter.",
    ),
  scenarioMappings: z.record(z.string(), agentInputBindingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});
export interface CodeAgentConfigSchema extends Named<typeof codeAgentConfigSchemaDefinition> {}
export const codeAgentConfigSchema: CodeAgentConfigSchema = codeAgentConfigSchemaDefinition;

export type CodeAgentConfig = z.infer<typeof codeAgentConfigSchema>;

/** A linked graph's fields as workflow last recorded them; workflow's facts write it. */
const workflowAgentFieldsSchemaDefinition = z.object({
  inputFields: z.array(fieldSchema),
  outputFields: z.array(fieldSchema),
  fieldsResolved: z.boolean(),
  recordedAt: z.number().int().nonnegative(),
});
export interface WorkflowAgentFieldsSchema extends Named<
  typeof workflowAgentFieldsSchemaDefinition
> {}
export const workflowAgentFieldsSchema: WorkflowAgentFieldsSchema =
  workflowAgentFieldsSchemaDefinition;
export type WorkflowAgentFields = z.infer<typeof workflowAgentFieldsSchema>;

const workflowAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  isCustom: z.boolean().optional(),
  workflow_id: z.string().optional(),
  publishedId: z.string().optional(),
  version_id: z.string().optional(),
  versions: z.record(z.string(), z.unknown()).optional(),
  workflowFields: workflowAgentFieldsSchema.optional(),
  scenarioMappings: z.record(z.string(), agentInputBindingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});
export interface WorkflowAgentConfigSchema extends Named<
  typeof workflowAgentConfigSchemaDefinition
> {}
export const workflowAgentConfigSchema: WorkflowAgentConfigSchema =
  workflowAgentConfigSchemaDefinition;

export type WorkflowAgentConfig = z.infer<typeof workflowAgentConfigSchema>;
