/**
 * "The caller's access refused": a refusal in which every violation is the caller's own access,
 * a gated field (the violation names the gates lacked) or a view some gate the caller lacks would
 * show. A view nobody could see, a bound-parameter table, or a refusal at the violation cap is not.
 * @see specs/lwql/query-origin.feature
 */
import {
  findLangWatchQLMissingGates,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";

import { MAX_VIOLATIONS, type RejectedLangWatchQL } from "./langwatch-ql-validation-shape.rules.ts";
import { cataloguePermissions, type LwqlCatalogue } from "./lwql-catalogue.rules.ts";

/** A caller holding every permission and content gate the catalogue names. */
export function fullGrantProtections({
  catalog,
}: {
  catalog: LwqlCatalogue;
}): LangWatchQLProtections {
  return {
    catalogue: { permissions: cataloguePermissions({ catalog }) },
    canSeeCosts: true,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
  };
}

/** The qualified, lowercased tables of views a caller's gates hide but a full grant would show. */
export function hiddenViewTables({
  database,
  showable,
  visible,
}: {
  database: string;
  showable: readonly { name: string }[];
  visible: readonly { name: string }[];
}): ReadonlySet<string> {
  const qualified = (list: readonly { name: string }[]) =>
    list.map(({ name }) => `${database}.${name}`.toLowerCase());
  const seen = new Set(qualified(visible));
  return new Set(qualified(showable).filter((table) => !seen.has(table)));
}

/** Whether every violation of a rejection is the caller's access: a gate lacked, a hidden view. */
export function isCallerAccessRejection({
  rejection,
  hiddenTables,
}: {
  rejection: RejectedLangWatchQL;
  hiddenTables: ReadonlySet<string>;
}): boolean {
  const hiddenViewRefusals = new Set(
    (rejection.refusedViews ?? [])
      .filter(({ table }) => hiddenTables.has(table))
      .map(({ violation }) => violation),
  );
  return (
    rejection.violations.length > 0 &&
    rejection.violations.length < MAX_VIOLATIONS &&
    rejection.violations.every(
      (violation) =>
        hiddenViewRefusals.has(violation) || findLangWatchQLMissingGates([violation]).length > 0,
    )
  );
}

/** The refusals of the values a caller sent rather than of the statement they sent them with. */
const CALLER_PARAMETER_REFUSAL_CODES: ReadonlySet<unknown> = new Set<unknown>([
  "lwql_parameter_missing",
  "lwql_granularity_too_fine",
  "lwql_reserved_parameter_supplied",
]);

/**
 * Whether a handled error refuses the caller's own parameters: a window left out, a step too
 * fine, a reserved name supplied.
 */
export function isCallerParameterRefusal({ error }: { error: unknown }): boolean {
  return CALLER_PARAMETER_REFUSAL_CODES.has((error as { code?: unknown } | null)?.code);
}
