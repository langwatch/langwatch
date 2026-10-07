import { z } from "zod";

const canonicalAttributesSchema = z.record(z.string(), z.unknown());

const canonicalEventSchema = z.object({
  name: z.string(),
  timeUnixMs: z.number(),
  attributes: canonicalAttributesSchema,
});

const canonicalSpanContextSchema = z.object({
  name: z.string(),
  kind: z.union([z.number(), z.string(), z.null()]),
  instrumentationScope: z.object({
    name: z.string(),
    version: z.string().nullish(),
  }),
  statusMessage: z.string().nullable(),
  statusCode: z.number().nullable(),
  parentSpanId: z.string().nullable(),
});

export type CanonicalAttributes = z.infer<typeof canonicalAttributesSchema>;
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
export type CanonicalSpanContext = z.infer<typeof canonicalSpanContextSchema>;
