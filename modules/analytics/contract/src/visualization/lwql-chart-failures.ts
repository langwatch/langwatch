/**
 * The two refusals the chart layer raises that validation cannot: whether
 * Vega compiles what it was given, and whether the rows hold anything to
 * draw. Shaped like every other refusal, so there is one way to report it.
 */

import { lwqlVegaError } from "./vega-lite-policy.ts";
import { JSON_POINTER_ROOT } from "./vega-lite-structure.ts";
import type { VegaValidationError } from "./visualization-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVegaValidationError(value: unknown): value is VegaValidationError {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.rule === "string" &&
    typeof value.path === "string" &&
    typeof value.message === "string"
  );
}

/**
 * A failure from inside Vega, once a specification is already accepted. A
 * loader refusal keeps its own (redacted) detail, since "tried to load
 * something" and "did not compile" call for different next steps.
 */
export function lwqlRenderFailure(error: unknown): VegaValidationError {
  const detail = isRecord(error) && isVegaValidationError(error.detail) ? error.detail : void 0;
  if (detail?.rule === "loader.blocked") return detail;

  const reason =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "the chart runtime gave no reason";

  return lwqlVegaError({
    rule: "render.failure",
    path: JSON_POINTER_ROOT,
    message: `The chart could not be drawn: ${reason}. Change the specification, or read the result in the table.`,
    meta: { reason },
  });
}

/**
 * Every encoded column of every dataset the chart reads is empty. Vega would
 * draw an empty plotting area, which looks identical to a chart that is still
 * loading and to one whose encoding names the wrong column.
 */
export function lwqlEmptyEncodingFailure({
  fieldsByDataset,
}: {
  fieldsByDataset: Readonly<Record<string, readonly string[]>>;
}): VegaValidationError {
  const fields = Object.values(fieldsByDataset).flat();
  const named = fields.length > 0 ? fields.join(", ") : "the encoded columns";

  return lwqlVegaError({
    rule: "encoding.empty",
    path: JSON_POINTER_ROOT,
    message: `There is nothing to draw: every value this chart encodes is empty or missing (${named}). Encode a different column, or change the query.`,
    meta: { fieldsByDataset },
  });
}
