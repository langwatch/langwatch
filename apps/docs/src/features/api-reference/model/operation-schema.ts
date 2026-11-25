import { z } from "zod/mini";

import type { Schema } from "./operation.ts";

const schema: z.ZodMiniType<Schema> = z.object({
  type: z.optional(z.union([z.string(), z.array(z.string())])),
  title: z.optional(z.string()),
  const: z.optional(z.unknown()),
  format: z.optional(z.string()),
  description: z.optional(z.string()),
  get properties() {
    return z.optional(z.record(z.string(), schema));
  },
  required: z.optional(z.array(z.string())),
  get items() {
    return z.optional(schema);
  },
  enum: z.optional(z.array(z.unknown())),
  default: z.optional(z.unknown()),
  example: z.optional(z.unknown()),
  nullable: z.optional(z.boolean()),
  deprecated: z.optional(z.boolean()),
  get additionalProperties() {
    return z.optional(z.union([z.boolean(), schema]));
  },
  get allOf() {
    return z.optional(z.array(schema));
  },
  get oneOf() {
    return z.optional(z.array(schema));
  },
  get anyOf() {
    return z.optional(z.array(schema));
  },
  minLength: z.optional(z.number()),
  maxLength: z.optional(z.number()),
  minimum: z.optional(z.number()),
  maximum: z.optional(z.number()),
  pattern: z.optional(z.string()),
  $recursive: z.optional(z.string()),
});
const content = z.object({
  type: z.string(),
  schema: z.nullable(schema),
  example: z.optional(z.unknown()),
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
      type: z.optional(z.string()),
      in: z.optional(z.string()),
      name: z.optional(z.string()),
      scheme: z.optional(z.string()),
      description: z.optional(z.string()),
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
  body: z.nullable(
    z.object({ required: z.boolean(), description: z.string(), contents: z.array(content) }),
  ),
  responses: z.array(
    z.object({ status: z.string(), description: z.string(), contents: z.array(content) }),
  ),
});
