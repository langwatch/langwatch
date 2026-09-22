/**
 * The `eval` chip: how an Instant Eval run is spelled in the filter language,
 * and how the run behind it is keyed to the scope it judged.
 *
 * `eval:"question"` judges what the lens shows: conversations on the
 * Conversations lens, traces everywhere else. `eval.trace:`,
 * `eval.conversation:` and `eval.llm:` force the unit judged, so a lens change
 * cannot silently change what a saved chip means.
 *
 * The run is keyed to the question, the unit judged, the other chips of the
 * query and the window. A rolling preset is keyed by its id rather than its
 * bounds, because the bounds move every tick and a run that re-ran on every
 * tick would be a bill rather than a filter. The bounds a run judged are the
 * ones bound when it started.
 *
 * Framework-free on purpose: the client computes keys and spells chips, the
 * server resolves the same chips against the runs the client sent.
 *
 * @see ../filter-to-clickhouse/instant-eval-field.ts: how a chip compiles
 * @see ../../../../../../specs/traces-v2/instant-eval-search.feature
 */

import type { LiqeQuery, TagToken } from "liqe";
import { isEmptyAST, parse, serialize } from "./parse";
import { filterAST, walkAST } from "./walk";

/** What one judged row is. Mirrors the run service's targets. */
export type InstantEvalChipTarget = "traces" | "threads" | "llm_spans";

/** The bare field, whose target comes from the lens. */
export const INSTANT_EVAL_FIELD = "eval";

/** The three spellings that force the unit judged. */
export const INSTANT_EVAL_TARGET_FIELDS: Readonly<
  Record<string, InstantEvalChipTarget>
> = {
  "eval.trace": "traces",
  "eval.conversation": "threads",
  "eval.llm": "llm_spans",
};

/** The lens whose rows are conversations, so its eval judges threads. */
export const CONVERSATIONS_LENS_ID = "conversations";

/** The unit an `eval:` chip judges on this lens. */
export function instantEvalTargetForLens(
  lensId: string | undefined,
): InstantEvalChipTarget {
  return lensId === CONVERSATIONS_LENS_ID ? "threads" : "traces";
}

/** Whether a field name is the eval field or one of its target spellings. */
export function isInstantEvalField(fieldName: string): boolean {
  return (
    fieldName === INSTANT_EVAL_FIELD ||
    Object.hasOwn(INSTANT_EVAL_TARGET_FIELDS, fieldName)
  );
}

/** The target a field spelling forces, or `null` for the bare field. */
export function instantEvalTargetOfField(
  fieldName: string,
): InstantEvalChipTarget | null {
  return Object.hasOwn(INSTANT_EVAL_TARGET_FIELDS, fieldName)
    ? (INSTANT_EVAL_TARGET_FIELDS[fieldName] ?? null)
    : null;
}

/** One eval chip as it appears in a query. */
export interface InstantEvalChip {
  /** The question, as the judge reads it. */
  question: string;
  /** The field it was written under. */
  field: string;
  /** The unit judged, resolved from the field or the lens. */
  target: InstantEvalChipTarget;
}

function chipValueOf(tag: TagToken): string | null {
  if (tag.expression.type !== "LiteralExpression") return null;
  const value = String(tag.expression.value).trim();
  return value.length > 0 ? value : null;
}

/** Every eval chip of the query, with its target resolved against the lens. */
export function instantEvalChipsOf({
  queryText,
  lensId,
}: {
  queryText: string;
  lensId: string | undefined;
}): InstantEvalChip[] {
  const trimmed = queryText.trim();
  if (!trimmed) return [];
  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    return [];
  }
  const lensTarget = instantEvalTargetForLens(lensId);
  const chips: InstantEvalChip[] = [];
  walkAST(ast, (node) => {
    if (node.type !== "Tag" || node.field.type === "ImplicitField") return;
    const field = node.field.name;
    if (!isInstantEvalField(field)) return;
    const question = chipValueOf(node as TagToken);
    if (question === null) return;
    chips.push({
      question,
      field,
      target: instantEvalTargetOfField(field) ?? lensTarget,
    });
  });
  return chips;
}

/**
 * The query with the eval chips `drop` names taken out, every other term left
 * as typed. A query that does not parse is returned as it came: there is no
 * chip to take out of it.
 */
function queryWithoutEvalChips({
  queryText,
  drop,
}: {
  queryText: string;
  drop: (chip: { field: string; value: string | null }) => boolean;
}): string {
  const trimmed = queryText.trim();
  if (!trimmed) return "";
  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    return trimmed;
  }
  const next = filterAST(ast, (node) => {
    if (node.type !== "Tag" || node.field.type === "ImplicitField") return true;
    const field = node.field.name;
    if (!isInstantEvalField(field)) return true;
    return !drop({ field, value: chipValueOf(node as TagToken) });
  });
  return isEmptyAST(next) ? "" : serialize(next);
}

/** The query with every eval chip removed: the scope a run judges. */
export function queryWithoutInstantEvalChips(queryText: string): string {
  return queryWithoutEvalChips({ queryText, drop: () => true });
}

/**
 * The query with one eval chip removed, every other term left as typed.
 *
 * The scope a run judges carries no eval chip at all, which is what
 * {@link queryWithoutInstantEvalChips} answers. This is the other question:
 * what the bar holds beside one chip, so the chip's run can put it back next
 * to the terms it was typed with, other eval chips included.
 */
export function queryWithoutInstantEvalChip({
  queryText,
  question,
}: {
  queryText: string;
  question: string;
}): string {
  const wanted = question.replace(/\s+/g, " ").trim();
  return queryWithoutEvalChips({
    queryText,
    drop: ({ value }) =>
      value !== null && value.replace(/\s+/g, " ").trim() === wanted,
  });
}

/**
 * The chip text for a question: the bare field when the target is what the
 * lens judges anyway, the forcing spelling when it is not.
 */
export function instantEvalChipText({
  question,
  target,
  lensId,
}: {
  question: string;
  target: InstantEvalChipTarget;
  lensId: string | undefined;
}): string {
  const field =
    target === instantEvalTargetForLens(lensId)
      ? INSTANT_EVAL_FIELD
      : (Object.entries(INSTANT_EVAL_TARGET_FIELDS).find(
          ([, candidate]) => candidate === target,
        )?.[0] ?? INSTANT_EVAL_FIELD);
  // Always quoted, even for a one-word question: the value is a sentence the
  // judge reads, and a chip that is sometimes bare reads as a different kind
  // of filter.
  const collapsed = question.replace(/\s+/g, " ").trim();
  return `${field}:"${collapsed.replace(/[\\"]/g, "\\$&")}"`;
}

/** The window half of a run key: a preset by its id, an absolute range by its bounds. */
export function instantEvalWindowKey(window: {
  from: number;
  to: number;
  presetId?: string;
}): string {
  return window.presetId
    ? `preset:${window.presetId}`
    : `${window.from}-${window.to}`;
}

/** FNV-1a over the scope, hex. Stable across sessions, short enough for a URL. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The key a run is registered under: the question, the unit judged, the
 * other chips and the window. Any change to one of them is a different key,
 * and therefore a different run started through the cost rule.
 */
export function instantEvalRunKey({
  question,
  target,
  otherQuery,
  window,
}: {
  question: string;
  target: InstantEvalChipTarget;
  otherQuery: string;
  window: { from: number; to: number; presetId?: string };
}): string {
  const scope = JSON.stringify([
    question.replace(/\s+/g, " ").trim(),
    target,
    otherQuery.trim(),
    instantEvalWindowKey(window),
  ]);
  return fnv1a(scope);
}

/** What the client sends for one registered run. */
export interface InstantEvalRunReference {
  question: string;
  target: InstantEvalChipTarget;
  runId: string;
}

/** A chip and the run behind it, or `null` when none is registered. */
export interface ResolvedInstantEvalChip extends InstantEvalChip {
  key: string;
  runId: string | null;
}

/**
 * The chips of a query matched to the runs the store holds, and the wire map
 * the reads send. A chip without a run is pending: it is sent to no read and
 * compiles to no rows, so the table stays truthful while the run starts.
 */
export function resolveInstantEvalChips({
  queryText,
  lensId,
  window,
  runsByKey,
}: {
  queryText: string;
  lensId: string | undefined;
  window: { from: number; to: number; presetId?: string };
  runsByKey: Readonly<Record<string, string>>;
}): {
  chips: ResolvedInstantEvalChip[];
  evalRuns: Record<string, InstantEvalRunReference> | undefined;
} {
  const chips = instantEvalChipsOf({ queryText, lensId });
  if (chips.length === 0) return { chips: [], evalRuns: undefined };
  const otherQuery = queryWithoutInstantEvalChips(queryText);
  const evalRuns: Record<string, InstantEvalRunReference> = {};
  const resolved = chips.map((chip) => {
    const key = instantEvalRunKey({
      question: chip.question,
      target: chip.target,
      otherQuery,
      window,
    });
    const runId = runsByKey[key] ?? null;
    if (runId) {
      evalRuns[key] = { question: chip.question, target: chip.target, runId };
    }
    return { ...chip, key, runId };
  });
  return {
    chips: resolved,
    evalRuns: Object.keys(evalRuns).length > 0 ? evalRuns : undefined,
  };
}
