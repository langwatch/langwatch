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
 * The one true total behind a result: what the query matched, which is NOT the
 * same as how many rows came back. This is the number the stat card rolls up, so
 * getting it right is the difference between "1,204 traces" and "25 traces".
 */
export const resolveTotal = ({
  pagination,
  rows,
}: {
  pagination?: Pagination | null;
  rows: readonly unknown[];
}): number =>
  pagination?.totalHits ?? pagination?.total ?? rows.length;

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
    [key]: z.array(row),
    pagination: paginationSchema.optional(),
  } as { [K in Key]: z.ZodArray<Row> } & { pagination: z.ZodOptional<typeof paginationSchema> });

/** An identifier, however the endpoint chose to spell it. */
export const idSchema = z
  .looseObject({
    id: z.string().optional(),
    slug: z.string().optional(),
  })
  .transform((raw) => raw.id ?? raw.slug);
