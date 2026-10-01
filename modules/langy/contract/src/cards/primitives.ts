/**
 * Reconciles pagination dialects once; loose schemas preserve unknown API fields.
 */
import * as z from "zod";

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
 * The marker a reduction leaves in place of the rows it removed, read back.
 * It now also states the true total ("… 29 more items truncated, 41
 * total"); older recorded conversations parse fine with `statedTotal` undefined.
 */
export const parseTruncationMarker = (
  row: unknown,
): { removed: number; statedTotal?: number } | undefined => {
  if (typeof row !== "string") return undefined;
  const match = /^…\s*(\d+)\s+more items truncated(?:,\s*(\d+)\s+total)?$/.exec(row.trim());
  if (!match) return undefined;
  const stated = match[2];
  return {
    removed: Number(match[1]),
    ...(stated === undefined ? {} : { statedTotal: Number(stated) }),
  };
};

/**
 * How many rows the upstream reduction took out of an array. Zero for
 * every other value, so a caller can fold this over rows without first
 * asking which of them are markers.
 */
export const truncatedAwayCount = (row: unknown): number =>
  parseTruncationMarker(row)?.removed ?? 0;

/** Whether a row is the reduction's marker rather than a result. */
export const isTruncationMarker = (row: unknown): boolean => truncatedAwayCount(row) > 0;

/**
 * Resolve true total: stated wins over counted, including reduction markers.
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
  const statedTotal = markers.find((marker) => marker?.statedTotal !== undefined)?.statedTotal;
  if (statedTotal !== undefined) return statedTotal;

  return markers.reduce<number>((count, marker) => count + (marker ? marker.removed : 1), 0);
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
 * Row or truncation marker: oversized outputs have in-band "… N more" strings in the array.
 */
export const rowOrTruncationMarker = <Row extends z.ZodType>(
  row: Row,
): z.ZodUnion<[Row, z.ZodString]> => z.union([row, z.string()]);

/**
 * Build a collection card: key differs per endpoint/resource, shape is declared once.
 */
export const collectionSchema = <Key extends string, Row extends z.ZodType>({
  key,
  row,
}: {
  key: Key;
  row: Row;
}): z.ZodObject<
  Record<Key, z.ZodType> & { pagination: z.ZodOptional<typeof paginationSchema> },
  z.core.$loose
> =>
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
