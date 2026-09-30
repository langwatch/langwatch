/**
 * Which read-time gate governs a column: input, output, or spend — the
 * three protections a viewer's `Protections` collapses to. Stated here
 * rather than imported, since nothing about a trace's projection reaches this package.
 */

import type {
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";
import {
  exposedCatalogueColumns,
  type LwqlExposedColumn,
  type LwqlTableCatalogue,
} from "./lwql-catalogue.rules.ts";

export type FieldProtection = "input" | "output" | "costs";

/**
 * The protections a caller actually holds, as the set the catalogue and the
 * reference both gate on.
 */
export function heldFieldProtections(
  protections: Readonly<{
    canSeeCapturedInput?: boolean | null;
    canSeeCapturedOutput?: boolean | null;
    canSeeCosts?: boolean | null;
  }>,
): ReadonlySet<FieldProtection> {
  const held = new Set<FieldProtection>();
  if (protections.canSeeCapturedInput === true) held.add("input");
  if (protections.canSeeCapturedOutput === true) held.add("output");
  if (protections.canSeeCosts === true) held.add("costs");

  return held;
}

/** A hand-written view before the catalogue gives it its gates. */
export type UngatedViewDefinition = Omit<LangWatchQLViewDefinition, "gates" | "columns"> &
  Readonly<{ columns: readonly Omit<LangWatchQLViewColumn, "gates">[] }>;

/**
 * The gates a catalogue column carries, until the services read its access directly. A column
 * permission other than `cost:view` has no gate to carry it, so it refuses rather than fail open.
 */
export function catalogueFieldProtections({
  column,
}: {
  column: LwqlExposedColumn;
}): readonly FieldProtection[] {
  const content = column.content === undefined ? [] : [column.content].flat();
  if (column.access === undefined) return content;
  const permissions = "allOf" in column.access ? column.access.allOf : column.access.anyOf;
  if (permissions.length !== 1 || permissions[0] !== "cost:view") {
    throw new Error(
      `lwql column "${column.name}": no gate carries access ${permissions.join(", ")}`,
    );
  }
  return [...content, "costs"];
}

/** Each exposed column's gates, by name, as the catalogue table declares them. */
export function catalogueColumnGates({
  table,
}: {
  table: LwqlTableCatalogue;
}): Readonly<Record<string, readonly FieldProtection[]>> {
  return Object.fromEntries(
    exposedCatalogueColumns({ table }).map((column) => [
      column.name,
      catalogueFieldProtections({ column }),
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
