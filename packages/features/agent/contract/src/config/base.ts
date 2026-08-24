import { z } from "zod";
import { fieldSchema } from "../fields";

export const baseAgentConfigSchema = z.object({
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

export type BaseAgentConfig = z.infer<typeof baseAgentConfigSchema>;
