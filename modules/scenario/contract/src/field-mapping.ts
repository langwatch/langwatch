import { z } from "zod";

/** How an agent input is filled from scenario data or a literal value. */
export const FieldMappingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    sourceId: z.string(),
    path: z.array(z.string()),
  }),
  z.object({ type: z.literal("value"), value: z.string() }),
]);

export type FieldMapping = z.infer<typeof FieldMappingSchema>;
