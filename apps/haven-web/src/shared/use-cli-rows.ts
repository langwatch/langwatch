import { z } from "zod";

import { getCliRead } from "./api.ts";
import { usePoll } from "./use-poll.ts";

/** Polls one `haven <name> --json` read for a stack. */
export const useCliRead = <Rows>({
  slug,
  name,
  rows,
  intervalMs = 5000,
}: {
  slug: string;
  name: string;
  rows: z.ZodType<Rows>;
  intervalMs?: number;
}) =>
  usePoll({
    key: `${slug}/${name}`,
    intervalMs,
    load: ({ signal }) => getCliRead({ slug, name, rows, signal }),
  });

/** useCliRead for a list read; Go's nil slice reads as no rows. */
export const useCliRows = <Row>({
  row,
  ...read
}: {
  slug: string;
  name: string;
  row: z.ZodType<Row>;
  intervalMs?: number;
}) =>
  useCliRead({
    ...read,
    rows: z
      .array(row)
      .nullable()
      .transform((rows) => rows ?? []),
  });
