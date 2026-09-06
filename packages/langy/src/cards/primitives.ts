/**
 * The generic pieces every LangWatch CLI result is built from.
 *
 * Almost every read the CLI performs is "a collection plus a way of counting it"
 * — and the platform, having grown over time, counts it two different ways:
 * traces come back with `pagination.totalHits`, everything paged comes back with
 * `pagination.total` + `page` + `totalPages`. Rather than make every card learn
 * both dialects, they are reconciled once, here, into a single `total`.
 *
 * Everything is a LOOSE object on purpose. These schemas describe the fields a
 * card needs, not the full API response, and a CLI result must survive the round
 * trip with its unknown fields intact — the card shows a summary, but the agent
 * reading the JSON may well want the rest.
 *
 * NOTE ON THE ZOD IMPORT: this package is consumed by the CLI (zod 4) and by the
 * app (zod 3.25). Both ship the v4 implementation on the `zod/v4` subpath, which
 * is the only specifier that resolves to the same schema runtime in both — so it
 * is the one this package imports, and the one it must keep importing until the
 * app's zod major catches up.
 */
import * as z from "zod/v4";

/** How the traces API counts: total hits for the query, regardless of page size. */
export const hitsPaginationSchema = z.looseObject({
  totalHits: z.number(),
  scrollId: z.string().optional(),
});

/** How the paged REST collections count: a total plus where you are in it. */
export const pagePaginationSchema = z.looseObject({
  total: z.number(),
  page: z.number().optional(),
  totalPages: z.number().optional(),
});

/**
 * Either dialect. Both keys are optional so a collection that reports neither
 * still parses — `resolveTotal` then falls back to counting the rows, which is
 * the honest answer for an endpoint that does not paginate.
 */
export const paginationSchema = z.looseObject({
  totalHits: z.number().optional(),
  total: z.number().optional(),
  page: z.number().optional(),
  totalPages: z.number().optional(),
  scrollId: z.string().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

/**
 * The marker a reduction leaves behind in place of the rows it removed, read
 * back. The marker now also states the true total ("… 29 more items truncated,
 * 41 total"); recorded conversations still carry the older form without it, so
 * both parse and `statedTotal` is undefined for the older one.
 */
export const parseTruncationMarker = (
  row: unknown,
): { removed: number; statedTotal?: number } | undefined => {
  if (typeof row !== "string") return undefined;
  const match = /^…\s*(\d+)\s+more items truncated(?:,\s*(\d+)\s+total)?$/.exec(
    row.trim(),
  );
  if (!match) return undefined;
  const stated = match[2];
  return {
    removed: Number(match[1]),
    ...(stated === undefined ? {} : { statedTotal: Number(stated) }),
  };
};

/**
 * How many rows the upstream reduction took out of an array.
 *
 * Zero for every other value, so a caller can fold this over rows without first
 * asking which of them are markers.
 */
export const truncatedAwayCount = (row: unknown): number =>
  parseTruncationMarker(row)?.removed ?? 0;

/** Whether a row is the reduction's marker rather than a result. */
export const isTruncationMarker = (row: unknown): boolean =>
  truncatedAwayCount(row) > 0;

/**
 * The one true total behind a result: what the query matched, which is NOT the
 * same as how many rows came back. This is the number the stat card rolls up, so
 * getting it right is the difference between "1,204 traces" and "25 traces".
 *
 * A stated total always wins over a counted one, and there are two places one
 * can be stated: the pagination envelope, and the reduction marker itself. A
 * result that states neither is counted, and the count has to include the rows
 * the reduction removed: their marker is the only record left that they
 * existed, so dropping it turns "41 prompts" into "12 prompts" beside an answer
 * that says 41.
 *
 * Pass the rows as the document holds them, markers included. A marker counts
 * as the rows it stands for, never as one row of its own.
 */
export const resolveTotal = ({
  pagination,
  rows,
}: {
  pagination?: Pagination | null;
  rows: readonly unknown[];
}): number => {
  const paginated = pagination?.totalHits ?? pagination?.total;
  if (paginated !== undefined) return paginated;

  const markers = rows.map(parseTruncationMarker);
  const statedTotal = markers.find(
    (marker) => marker?.statedTotal !== undefined,
  )?.statedTotal;
  if (statedTotal !== undefined) return statedTotal;

  return markers.reduce<number>(
    (count, marker) => count + (marker ? marker.removed : 1),
    0,
  );
};

/**
 * A text field the platform sends either bare (`"hello"`) or wrapped in the trace
 * envelope (`{ value: "hello" }`). Normalised to the bare string so a card never
 * has to ask which one it got.
 */
export const textValueSchema = z
  .union([z.string(), z.looseObject({ value: z.string() })])
  .transform((raw) => (typeof raw === "string" ? raw : raw.value))
  .transform((text) => text.trim())
  .pipe(z.string());

/**
 * A row in a collection, tolerating the in-band truncation marker.
 *
 * Oversized tool outputs are structure-reduced upstream (the worker caps long
 * arrays and appends a plain string like "… 40 more items truncated" INSIDE the
 * array). A schema that insisted every element is a row would reject exactly
 * the results big enough to have needed reducing — so every collection accepts
 * a string element and readers skip it.
 */
export const rowOrTruncationMarker = <Row extends z.ZodType>(row: Row) =>
  z.union([row, z.string()]);

/**
 * Build a collection card: `{ <key>: rows[], pagination }`.
 *
 * The key differs per endpoint (`traces`, `data`, `records`, …) and the row shape
 * differs per resource, but the shape around them never does — so it is declared
 * once and specialised, rather than copy-pasted per card.
 */
export const collectionSchema = <Key extends string, Row extends z.ZodType>({
  key,
  row,
}: {
  key: Key;
  row: Row;
}) =>
  z.looseObject({
    [key]: z.array(rowOrTruncationMarker(row)),
    pagination: paginationSchema.optional(),
  } as Record<Key, z.ZodType> & { pagination: z.ZodOptional<typeof paginationSchema> });

/** An identifier, however the endpoint chose to spell it. */
export const idSchema = z
  .looseObject({
    id: z.string().optional(),
    slug: z.string().optional(),
  })
  .transform((raw) => raw.id ?? raw.slug);
