/**
 * The `CustomGraph.kind` values, and the one place they are spelled.
 *
 * Two features share the `CustomGraph` table: the chart builder, which has been
 * writing rows since before the column existed, and the governed SQL workbench,
 * whose `graph` column holds a versioned `{ sql, parameters, vegaLiteSpec }`
 * definition instead of a builder payload. `kind` is what keeps them apart.
 *
 * The constants live here — above both features rather than inside either —
 * because the isolation is mutual and a discriminator owned by one side is one
 * the other has to import from a module it otherwise has no business knowing
 * about. Every reader on both sides filters by the value it owns, which is what
 * makes the schema's claim ("neither sees the other's rows") true in both
 * directions rather than only in the newer one.
 *
 * @see prisma/schema.prisma — the `CustomGraph.kind` column
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

/**
 * The kind every chart-builder row carries.
 *
 * Also the column's default, so a builder create needs no explicit value and
 * every row written before the discriminator existed already reads as one.
 * Changing this string means writing a migration that rewrites those rows.
 */
export const BUILDER_CHART_KIND = "builder";

/** The kind a saved governed SQL workbench chart carries. */
export const WORKBENCH_SQL_CHART_KIND = "workbench_sql";
