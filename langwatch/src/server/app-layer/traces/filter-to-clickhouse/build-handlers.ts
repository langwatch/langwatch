import { FACET_REGISTRY, TABLE_TIME_COLUMNS } from "../facet-registry";
import { CUSTOM_FACET_HANDLERS } from "./custom-handlers";
import {
  crossTableNumericComparison,
  crossTableStringEquality,
  numericComparison,
  stringEquality,
} from "./generic-translators";
import { META_HANDLERS } from "./meta-handlers";
import type { FieldHandler } from "./value-helpers";

function buildFieldHandlers(): Record<string, FieldHandler> {
  const handlers: Record<string, FieldHandler> = {};

  for (const def of FACET_REGISTRY) {
    // Dynamic keys are not directly filterable as a single field
    if (def.kind === "dynamic_keys") continue;

    // Custom override takes precedence
    const custom = CUSTOM_FACET_HANDLERS[def.key];
    if (custom) {
      handlers[def.key] = custom;
      continue;
    }

    // Auto-derive from facet definition
    if (def.kind === "categorical" && "expression" in def) {
      if (def.table === "trace_summaries") {
        handlers[def.key] = stringEquality(def.expression);
      } else {
        handlers[def.key] = crossTableStringEquality(
          def.table,
          TABLE_TIME_COLUMNS[def.table],
          def.expression,
        );
      }
    } else if (def.kind === "range") {
      if (def.table === "trace_summaries") {
        handlers[def.key] = numericComparison(def.expression);
      } else {
        handlers[def.key] = crossTableNumericComparison(
          def.table,
          TABLE_TIME_COLUMNS[def.table],
          def.expression,
        );
      }
    }
    // Query-builder categoricals without custom handler are skipped
  }

  // Meta-fields that don't correspond to registry facets
  Object.assign(handlers, META_HANDLERS);

  return handlers;
}

export const FIELD_HANDLERS = buildFieldHandlers();

/** All known filter field names, derived from registry + meta-fields. */
export const KNOWN_FIELDS = Object.keys(FIELD_HANDLERS);
