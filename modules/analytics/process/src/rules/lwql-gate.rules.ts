/**
 * The gates a LangWatchQL column or app function carries: captured content, which the project's
 * data-privacy policy decides, or a registry permission, which authz decides. A gate list is allOf.
 * @see specs/lwql/catalogue-grants.feature
 */

import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { AuthzPermission } from "@langwatch/authorization";

import type {
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";
import {
  exposedCatalogueColumns,
  type LwqlContent,
  type LwqlExposedColumn,
  type LwqlTableCatalogue,
} from "./lwql-catalogue.rules.ts";

export type LwqlGate = LwqlContent | AuthzPermission;

/**
 * The gates a caller holds: the catalogue permissions authz granted and the content the policy
 * shows. `cost:view` needs `canSeeCosts` as well, so the two sources can only narrow each other.
 */
export function heldLwqlGates(protections: LangWatchQLProtections): ReadonlySet<LwqlGate> {
  const held = new Set<LwqlGate>(protections.catalogue.permissions);
  if (protections.canSeeCosts !== true) held.delete("cost:view");
  if (protections.canSeeCapturedInput === true) held.add("input");
  if (protections.canSeeCapturedOutput === true) held.add("output");
  return held;
}

/** The gates as the schema publishes them: `costs` stays beside `cost:view` for main's readers. */
export function publishedLwqlGates(gates: readonly LwqlGate[]): readonly (LwqlGate | "costs")[] {
  return gates.includes("cost:view") ? ["costs", ...gates] : gates;
}

/** A hand-written view before the catalogue gives it its gates. */
export type UngatedViewDefinition = Omit<LangWatchQLViewDefinition, "gates" | "columns"> &
  Readonly<{ columns: readonly Omit<LangWatchQLViewColumn, "gates">[] }>;

/**
 * The gates a catalogue column carries: its content, then its permissions. A gate list is allOf,
 * so a column access of anyOf more than one permission refuses rather than fail open.
 */
export function catalogueColumnGatesOf({
  column,
}: {
  column: LwqlExposedColumn;
}): readonly LwqlGate[] {
  const content = column.content === undefined ? [] : [column.content].flat();
  if (column.access === undefined) return content;
  if ("anyOf" in column.access && column.access.anyOf.length > 1) {
    throw new Error(`lwql column "${column.name}": a column access cannot be anyOf`);
  }
  const permissions = "allOf" in column.access ? column.access.allOf : column.access.anyOf;
  return [...content, ...permissions];
}

/** Each exposed column's gates, by name, as the catalogue table declares them. */
export function catalogueColumnGates({
  table,
}: {
  table: LwqlTableCatalogue;
}): Readonly<Record<string, readonly LwqlGate[]>> {
  return Object.fromEntries(
    exposedCatalogueColumns({ table }).map((column) => [
      column.name,
      catalogueColumnGatesOf({ column }),
    ]),
  );
}

/** A hand-written view with each column gated as its catalogue table says; names must agree. */
export function withCatalogueGates({
  view,
  table,
}: {
  view: UngatedViewDefinition;
  table: LwqlTableCatalogue;
}): LangWatchQLViewDefinition {
  const gates = catalogueColumnGates({ table });
  return {
    ...view,
    gates: [],
    columns: view.columns.map((column) => {
      const columnGates = gates[column.name];
      if (columnGates === undefined) {
        throw new Error(
          `lwql view "${view.name}": column "${column.name}" is not in its catalogue`,
        );
      }
      return { ...column, gates: columnGates };
    }),
  };
}
