import { z } from "zod";

/** One seedgen action, mirroring `Action` in tools/seedgen/protocol.go (plan §2). */
export const seedActionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    ref: z.string().min(1).optional(),
    org: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    as: z.string().min(1).optional(),
    key: z.string().default(""),
    input: z.unknown(),
    at: z.iso.datetime().optional(),
  })
  .strict();
export type SeedAction = z.infer<typeof seedActionSchema>;

export const seedAckSchema = z
  .object({
    id: z.string().min(1),
    ok: z.literal(true),
    refs: z.record(z.string(), z.string()).optional(),
    /** The action found what it names instead of creating it: a re-run. */
    existing: z.literal(true).optional(),
  })
  .strict();
export type SeedAck = z.infer<typeof seedAckSchema>;

export const seedRefusalSchema = z
  .object({
    id: z.string().min(1),
    ok: z.literal(false),
    code: z.string().min(1),
    retryable: z.boolean().optional(),
  })
  .strict();
export type SeedRefusal = z.infer<typeof seedRefusalSchema>;

export const seedReplySchema = z.discriminatedUnion("ok", [seedAckSchema, seedRefusalSchema]);
export type SeedReply = z.infer<typeof seedReplySchema>;

/** The id field still holding a symbolic `$ref`: seedgen substitutes every ref before sending. */
export function unresolvedRefOf(action: SeedAction): string | undefined {
  return (["org", "project", "as"] as const).find((field) => action[field]?.startsWith("$"));
}
