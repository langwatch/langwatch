// POST /api/trace/search body; shared analytics filter plus four additive
// fields, parsed STRICTLY to reject unknown keys as it always has
import { traceListInputSchema } from "@langwatch/trace-contract";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import type { TraceLegacySearchFields } from "../transport/trace-legacy.rest.ts";

/** Either wire spelling of a window bound: epoch milliseconds, or a parseable date. */
function dateBound(
  field: "startDate" | "endDate",
): z.ZodUnion<readonly [z.ZodNumber, z.ZodString]> {
  return z.union([
    z.number(),
    z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: `Invalid date format for ${field}`,
    }),
  ]);
}

const searchBodySchema = traceListInputSchema
  .omit({ projectId: true, startDate: true, endDate: true })
  .extend({
    startDate: dateBound("startDate"),
    endDate: dateBound("endDate"),
    scrollId: z.string().optional().nullable(),
    format: z.enum(["digest", "json"]).optional(),
    llmMode: z.boolean().optional().default(false),
  })
  .strict();

/**
 * The same schema, as the family's member declares it. The declared output is
 * this endpoint's own four fields; every other key the shared filter vocabulary
 * admits rides along on the parsed value and is handed to the read untouched.
 */
export const traceLegacySearchBodySchema = searchBodySchema as unknown as z.ZodType<
  TraceLegacySearchFields,
  unknown
>;

/**
 * Renders a schema failure as the one sentence this family answers with. The
 * endpoint predates the boundary's structured envelope and a deployed client
 * reads the prose, so the rendering is part of the wire.
 */
export function describeTraceLegacyValidationError(error: unknown): string {
  return fromZodError(error as never).message;
}
