/**
 * Runtime invariant: an AG-UI `binary` content part must carry exactly one
 * of `data`, `url`, or `id`. Anything else is structurally ambiguous —
 * "is this inline bytes or a reference?" — and the extractor would do
 * the wrong thing depending on which field it checked first.
 *
 * The shared `chatRichContentSchema` binary variant (`src/server/tracer/types.ts`)
 * only checks that each field is a string-or-absent; mutual exclusion is a
 * stricter, ingest-time constraint that doesn't belong on the broad shared
 * shape. Wrapping it here keeps the constraint in one place that the extractor
 * and the scenario-events route can both call.
 */
import { z } from "zod";

export const binaryInputPartSchema = z
  .object({
    type: z.literal("binary"),
    mimeType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
    filename: z.string().optional(),
  })
  .refine(
    (part) => {
      const present =
        Number(part.data !== undefined) +
        Number(part.url !== undefined) +
        Number(part.id !== undefined);
      return present === 1;
    },
    {
      message:
        "binary part must carry exactly one of data, url, or id (got zero or more than one)",
    },
  );

export type BinaryInputPart = z.infer<typeof binaryInputPartSchema>;
