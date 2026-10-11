import { z } from "zod";

import type { Schema } from "./operation.ts";

const schema: z.ZodType<Schema> = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.string().optional(),
  description: z.string().optional(),
  get properties() {
    return z.record(z.string(), schema).optional();
  },
  required: z.array(z.string()).optional(),
  get items() {
    return schema.optional();
  },
  enum: z.array(z.unknown()).optional(),
  default: z.unknown().optional(),
  example: z.unknown().optional(),
  nullable: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  get additionalProperties() {
    return z.union([z.boolean(), schema]).optional();
  },
  get allOf() {
    return z.array(schema).optional();
  },
  get oneOf() {
    return z.array(schema).optional();
  },
  get anyOf() {
    return z.array(schema).optional();
  },
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  pattern: z.string().optional(),
  $recursive: z.string().optional(),
});
const content = z.object({
  type: z.string(),
  schema: schema.nullable(),
  example: z.unknown().optional(),
});
export const operationSchema = z.object({
  method: z.string(),
  path: z.string(),
  origin: z.url(),
  summary: z.string(),
  description: z.string(),
  deprecated: z.boolean(),
  schemes: z.array(
    z.object({
      id: z.string(),
      type: z.string().optional(),
      in: z.string().optional(),
      name: z.string().optional(),
      scheme: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  parameters: z.array(
    z.object({
      in: z.string(),
      name: z.string(),
      required: z.boolean(),
      deprecated: z.boolean(),
      description: z.string(),
      schema,
    }),
  ),
  body: z
    .object({ required: z.boolean(), description: z.string(), contents: z.array(content) })
    .nullable(),
  responses: z.array(
    z.object({ status: z.string(), description: z.string(), contents: z.array(content) }),
  ),
});
