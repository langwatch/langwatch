import { z } from "zod";
import { agentInputBindingSchema, fieldSchema } from "../fields.ts";
import { baseAgentConfigSchema } from "./base.ts";

export const codeParameterSchema = z.object({
  identifier: z.literal("code"),
  type: z.literal("code"),
  value: z.string(),
  optional: z.boolean().optional(),
  desc: z.string().optional(),
  prefix: z.string().optional(),
  hidden: z.boolean().optional(),
});

export const codeAgentConfigSchema = z.object({
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

export type CodeAgentConfig = z.infer<typeof codeAgentConfigSchema>;
