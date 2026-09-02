/**
 * The `CustomGraph.kind` values, as the browser reads them.
 *
 * Two features share the stored-chart table: the chart builder, which has been
 * writing rows since before the column existed, and the LangWatchQL workbench,
 * whose `graph` column holds a versioned `{ sql, parameters, vegaLiteSpec }`
 * definition instead of a builder payload. `kind` is what keeps them apart, and
 * a report grid that reads the wrong one draws the wrong editor.
 *
 * `platform/app/src/server/analytics/chartKinds.ts` is the writing side's
 * declaration and stays where it is — the routers, the REST surface and the
 * migration all read it, and deletes-only forbids repointing them. The two
 * strings are the wire, so a copy that disagrees is a bug either way round;
 * `chart-kinds.unit.test.ts` pins the values rather than the identity.
 *
 * @see prisma/schema.prisma — the `CustomGraph.kind` column
 * @see specs/analytics/lwql-saved-charts.feature
 */

/** The kind every chart-builder row carries, and the column's default. */
export const BUILDER_CHART_KIND = "builder";

/** The kind a saved LangWatchQL workbench chart carries. */
export const WORKBENCH_SQL_CHART_KIND = "workbench_sql";
