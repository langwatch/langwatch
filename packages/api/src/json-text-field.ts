import { z } from "zod";

/**
 * A field whose wire value is JSON text and whose parsed value `schema` reads (rulings
 * 2026-10-06, round 7, Q39). Unparseable text is a schema issue the door refuses like any other
 * malformed field, and the caller's inferred input type stays `string`.
 */
export function jsonTextField<Schema extends z.ZodType>(schema: Schema) {
  return z
    .string()
    .transform((text, context): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        context.addIssue({ code: "custom", message: "Expected JSON text" });
        return z.NEVER;
      }
    })
    .pipe(schema);
}
