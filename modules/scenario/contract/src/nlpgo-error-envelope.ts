/**
 * The error envelope nlpgo answers a failed call with, read by the parent's scenario generation and
 * the child's execution-error rules alike.
 */

import { handledErrorFaultSchema } from "@langwatch/handled-error";
import { z } from "zod";

/**
 * nlpgo error envelope: `fault` is declared optional but never on wire; don't classify on it.
 * See scenario code-agent adapter's `parseErrorEnvelope`.
 */
export const goErrorEnvelopeSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    fault: handledErrorFaultSchema.optional(),
    tips: z.array(z.string()).optional(),
    docs_url: z.string().optional(),
  }),
});
