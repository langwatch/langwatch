import { z } from "zod";

export const MIN_AGENT_CACHE_TTL_SECONDS = 5;
export const MAX_AGENT_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const MAX_AGENT_CACHE_VALUE_BYTES = 32 * 1024;
export const MAX_AGENT_CACHE_NAME_LENGTH = 64;
export const DEFAULT_AGENT_CACHE_TTL_SECONDS = 15 * 60;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined) continue;
    if (point <= 0x7f) bytes += 1;
    else if (point <= 0x7ff) bytes += 2;
    else if (point <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export const gatewayAgentCacheNameParamsSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(MAX_AGENT_CACHE_NAME_LENGTH, "name is too long")
    .regex(
      /^[A-Z][A-Z0-9_]*$/,
      "name must contain only uppercase letters, digits, and underscores, and must start with a letter",
    ),
});

export const gatewayAgentCacheWriteSchema = z.object({
  value: z
    .string()
    .min(1, "value is required")
    .refine(
      (value) => utf8ByteLength(value) <= MAX_AGENT_CACHE_VALUE_BYTES,
      `value is too long; the limit is ${MAX_AGENT_CACHE_VALUE_BYTES} bytes`,
    ),
  ttl_seconds: z
    .number()
    .int()
    .min(MIN_AGENT_CACHE_TTL_SECONDS)
    .max(MAX_AGENT_CACHE_TTL_SECONDS)
    .optional(),
});

export const gatewayAgentCacheEntrySchema = z.object({ name: z.string(), value: z.string() });
export const gatewayAgentCacheWrittenSchema = z.object({
  name: z.string(),
  ttl_seconds: z.number(),
});
export const gatewayAgentCacheClaimedSchema = z.object({
  ...gatewayAgentCacheWrittenSchema.shape,
  claimed: z.boolean(),
});
export const gatewayAgentCacheDeletedSchema = z.object({
  name: z.string(),
  deleted: z.boolean(),
});
