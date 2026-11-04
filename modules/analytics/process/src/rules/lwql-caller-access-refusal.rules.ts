/**
 * "The caller's access refused": a refusal in which every violation is the caller's own access,
 * either a gated field (the violation names the gates lacked) or a view the full catalogue holds
 * that their protections hide. A view the catalogue lacks, or a bound-parameter table, is not.
 * @see specs/lwql/query-origin.feature
 */
import { findLangWatchQLMissingGates } from "@langwatch/analytics-contract";

import type { RejectedLangWatchQL } from "./langwatch-ql-validation-shape.rules.ts";

/** Marked in memory so the member's response never carries the verdict. */
const MARKED = new WeakSet<object>();

/**
 * Marks the error about to be thrown when its rejection is the caller's access. Hidden is
 * decided here, where the full catalogue and the caller's visible views are both known.
 */
export function markIfCallerAccessRefusal({
  error,
  rejection,
  database,
  views,
}: {
  error: object;
  rejection: RejectedLangWatchQL;
  database: string;
  views: { all: readonly { name: string }[]; visible: readonly { name: string }[] };
}): void {
  const qualified = (list: readonly { name: string }[]) =>
    list.map(({ name }) => `${database}.${name}`.toLowerCase());
  const visible = new Set(qualified(views.visible));
  const hiddenTables = new Set(qualified(views.all).filter((table) => !visible.has(table)));
  if (isCallerAccessRejection({ rejection, hiddenTables })) MARKED.add(error);
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
    rejection.violations.every(
      (violation) =>
        hiddenViewRefusals.has(violation) || findLangWatchQLMissingGates([violation]).length > 0,
    )
  );
}

export function isCallerAccessRefusal({ error }: { error: unknown }): boolean {
  if (typeof error === "object" && error !== null && MARKED.has(error)) return true;
  const { code, meta } = (error ?? {}) as { code?: unknown; meta?: { violations?: unknown } };
  return code === "lwql_not_permitted" && findLangWatchQLMissingGates(meta?.violations).length > 0;
}
