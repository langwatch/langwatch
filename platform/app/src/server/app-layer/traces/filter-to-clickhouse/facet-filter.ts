import type { LiqeQuery } from "liqe";
import { isEmptyAST, parse, serialize } from "../query-language/parse";
import { filterAST } from "../query-language/walk";
import { translateFilterToClickHouse } from "./ast";

export interface FacetFilterWhere {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Whether a tag names the facet's field, or one of its dotted sub-fields
 * (`evaluator.verdict` belongs to the `evaluator` facet, `event.attribute.x`
 * to `event`).
 */
function tagBelongsToFacet(node: LiqeQuery, facetKey: string): boolean {
  if (node.type !== "Tag") return false;
  if (node.field.type === "ImplicitField") return false;
  const name = node.field.name;
  return name === facetKey || name.startsWith(`${facetKey}.`);
}

/**
 * Whether the query has a term on the facet's field. Free-text terms and other
 * fields do not count, so a facet the query never names keeps the whole query.
 */
export function queryNamesFacet({
  queryText,
  facetKey,
}: {
  queryText: string;
  facetKey: string;
}): boolean {
  if (!queryText.trim()) return false;
  let named = false;
  try {
    filterAST(parse(queryText), (node) => {
      if (tagBelongsToFacet(node, facetKey)) named = true;
      return true;
    });
  } catch {
    return false;
  }
  return named;
}

/**
 * The query with every term on the facet's own field removed, so the facet
 * keeps counting its other values while the rest of the query applies. A
 * query that only named this facet becomes empty.
 */
export function queryWithoutFacet({
  queryText,
  facetKey,
}: {
  queryText: string;
  facetKey: string;
}): string {
  if (!queryText.trim()) return "";
  const next = filterAST(
    parse(queryText),
    (node) => !tagBelongsToFacet(node, facetKey),
  );
  return isEmptyAST(next) ? "" : serialize(next);
}

/**
 * Compiles the active query once per facet field it names, and once for every
 * facet it does not. `forFacet` answers the same object for facets that share
 * a compile, so a caller can group its reads by filter identity.
 *
 * Syntax errors surface as the compiler's own `FilterParseError`, the same
 * one the list read raises for the same text.
 */
export function createFacetFilterCompiler({
  queryText,
  tenantId,
  timeRange,
}: {
  queryText: string;
  tenantId: string;
  timeRange: { from: number; to: number };
}): { forFacet: (facetKey: string) => FacetFilterWhere | undefined } {
  const compile = (text: string) =>
    translateFilterToClickHouse(text, tenantId, timeRange) ?? undefined;
  const whole = compile(queryText);
  const byFacet = new Map<string, FacetFilterWhere | undefined>();
  return {
    forFacet: (facetKey) => {
      if (!queryNamesFacet({ queryText, facetKey })) return whole;
      if (!byFacet.has(facetKey)) {
        byFacet.set(
          facetKey,
          compile(queryWithoutFacet({ queryText, facetKey })),
        );
      }
      return byFacet.get(facetKey);
    },
  };
}
