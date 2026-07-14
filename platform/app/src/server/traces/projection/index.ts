/**
 * Schema compiler for the trace projection DSL (Track 1, API Export Traces RFC).
 *
 * The single translator from the JSON `from` + `select` contract to a
 * ClickHouse/Postgres query plan + a per-trace response projector. Mirrors the
 * existing filter compiler (`generateClickHouseFilterConditions`): an allowlist
 * of selectable paths, never raw identifiers from the caller.
 *
 * Public surface (stable contract — app.v1.ts depends only on this):
 *   compileProjection({ from, select, protections }) -> CompiledProjection
 *     .schema  -> response envelope `schema` field
 *     .plan    -> getAllTracesForProject options.projection
 *     .project -> per-trace serializer (replaces formatTrace when active)
 *   ProjectionValidationError -> map to HTTP 400
 */

export { compileProjection } from "./compile-projection";
export * from "./types";
