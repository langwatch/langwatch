/**
 * Content-visibility gating for LWQL.
 *
 * Issue #6346 decision 7. ADR-028 gates *content* for callers outside their
 * plan's visibility window, while explicitly leaving aggregates visible. That
 * was safe while aggregates were fixed, developer-authored dashboard charts. It
 * stops being safe the moment the filter is caller-supplied:
 *
 *     SELECT count(*) FROM traces WHERE input LIKE '%acme corp%'
 *
 * That projects no content, satisfies a projection-only rule, and still reads
 * the gated value one bit at a time. Binary-searching a string this way is
 * linear in its length.
 *
 * So a gated field is refused as a *filter* and *aggregation* target exactly as
 * it is as an output column. Refused, not teased — teasing a filter target is
 * meaningless when the predicate is evaluated against the stored value.
 *
 * The gated set is not restated here. `CONTENT_FIELD_MAP` maps each field the
 * redaction service touches to its LWQL counterpart, and
 * `__tests__/gating-parity.unit.test.ts` derives the service's real set by
 * probing `redactTraceContent` / `redactSpanContent` and asserts the two agree.
 * Adding a field to the redaction service without teaching LWQL about it fails
 * CI rather than silently opening an oracle.
 */

import { ENTITIES, getEntity, type LwqlEntityDef } from "./catalog";
import { LwqlError } from "./errors";

/**
 * Every content field the visibility-window service redacts, mapped to the LWQL
 * field that exposes it — or `null` where LWQL exposes no such column.
 *
 * `null` is a real answer, not a gap: `trace_summaries` has no column for
 * `expected_output` or `contexts`, so there is nothing to gate. It is recorded
 * anyway so that the parity test can tell "deliberately not exposed" apart from
 * "newly added to the redaction service and forgotten here".
 */
export const CONTENT_FIELD_MAP: Record<
  "trace" | "span",
  Record<string, { entity: string; field: string } | null>
> = {
  trace: {
    input: { entity: "traces", field: "input" },
    output: { entity: "traces", field: "output" },
    error: { entity: "traces", field: "error" },
    // Not columns on `trace_summaries`; unreachable from LWQL.
    expected_output: null,
    contexts: null,
  },
  span: {
    input: null,
    output: null,
    params: null,
    error: { entity: "spans", field: "error" },
  },
};

/**
 * Whether gating is active for this caller.
 *
 * `cutoffMs` is the epoch-ms boundary from
 * `VisibilityWindowService.getVisibilityCutoffMs` — `null` means the plan has
 * no visibility window and nothing is gated.
 */
export interface GatingContext {
  cutoffMs: number | null;
}

/**
 * True when a query may touch gated fields at all.
 *
 * Deliberately coarse: gating is per-caller, not per-row. A query could in
 * principle be allowed to read content strictly inside the window, but that
 * makes the *predicate* the thing deciding what is visible, which is the exact
 * inversion this module exists to prevent. Whole-query refusal is the
 * conservative direction, and it is the reversible one — relaxing later is
 * safe, and widening after data has left is not.
 */
export const gatingActive = (ctx: GatingContext): boolean =>
  ctx.cutoffMs !== null;

/**
 * Refuses a gated field used anywhere in a query — projection, filter, group,
 * or order — when gating is active for the caller.
 */
export const assertFieldAllowed = ({
  entity,
  fieldName,
  usage,
  ctx,
}: {
  entity: LwqlEntityDef;
  fieldName: string;
  usage: "select" | "filter" | "group_by" | "order_by";
  ctx: GatingContext;
}): void => {
  const field = entity.fields[fieldName];
  if (!field?.contentGated) return;
  if (!gatingActive(ctx)) return;

  throw new LwqlError(
    "content_gated",
    `Field '${fieldName}' is not available on your current plan.`,
    {
      hint:
        usage === "select"
          ? "Content fields are restricted outside your plan's visibility window. Remove it from SELECT, or upgrade to query full history."
          : `Content fields cannot be used in ${usage.replace("_", " ").toUpperCase()} outside your plan's visibility window — filtering on a value reveals it. Upgrade to query full history.`,
    },
  );
};

/** Gated field names per entity, for the catalogue endpoint and error copy. */
export const gatedFieldsByEntity = (): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(ENTITIES).map(([name, entity]) => [
      name,
      Object.entries(entity.fields)
        .filter(([, def]) => def.contentGated)
        .map(([field]) => field),
    ]),
  );

/**
 * Resolves the LWQL fields that `CONTENT_FIELD_MAP` claims are gated, so the
 * parity test can compare against the catalogue without duplicating the walk.
 */
export const mappedGatedFields = (): Set<string> => {
  const result = new Set<string>();
  for (const mapping of Object.values(CONTENT_FIELD_MAP)) {
    for (const target of Object.values(mapping)) {
      if (target === null) continue;
      if (!getEntity(target.entity)) {
        throw new Error(
          `CONTENT_FIELD_MAP references unknown entity '${target.entity}'.`,
        );
      }
      result.add(`${target.entity}.${target.field}`);
    }
  }
  return result;
};
