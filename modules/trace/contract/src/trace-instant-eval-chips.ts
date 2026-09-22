/**
 * The `eval` chip: how an Instant Eval run is spelled in the filter language,
 * and how the run behind it is keyed to the scope it judged.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { InstantEvalRunReference, InstantEvalTarget } from "@langwatch/instant-eval-contract";
import type { LiqeQuery } from "liqe";

import { filterAST, walkAST } from "./trace-query-ast.ts";
import { isEmptyAST, parse, serialize } from "./trace-query-parser.ts";

/** The bare field, whose target comes from the lens. */
export const INSTANT_EVAL_FIELD = "eval";

/**
 * The three spellings that force the unit judged, so a lens change cannot
 * silently change what a saved chip means.
 */
export const INSTANT_EVAL_TARGET_FIELDS: Readonly<Record<string, InstantEvalTarget>> = {
  "eval.trace": "traces",
  "eval.conversation": "threads",
  "eval.llm": "llm_spans",
};

/** The lens whose rows are conversations, so its eval judges threads. */
export const CONVERSATIONS_LENS_ID = "conversations";

/** The unit an `eval:` chip judges on this lens. */
export function instantEvalTargetForLens(lensId: string | undefined): InstantEvalTarget {
  return lensId === CONVERSATIONS_LENS_ID ? "threads" : "traces";
}

/** Whether a field name is the eval field or one of its target spellings. */
export function isInstantEvalField(fieldName: string): boolean {
  return fieldName === INSTANT_EVAL_FIELD || Object.hasOwn(INSTANT_EVAL_TARGET_FIELDS, fieldName);
}

/** The unit a chip judges: what its field forces, or what the lens shows. */
export function instantEvalTargetOf({
  fieldName,
  lensId,
}: {
  fieldName: string;
  lensId: string | undefined;
}): InstantEvalTarget {
  return INSTANT_EVAL_TARGET_FIELDS[fieldName] ?? instantEvalTargetForLens(lensId);
}

/** One eval chip as it appears in a query. */
export interface InstantEvalChip {
  /** The question, as the judge reads it. */
  question: string;
  /** The field it was written under. */
  field: string;
  /** The unit judged, resolved from the field or the lens. */
  target: InstantEvalTarget;
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
  const chips: InstantEvalChip[] = [];
  walkAST(ast, (node) => {
    if (node.type !== "Tag" || node.field.type === "ImplicitField") return;
    const field = node.field.name;
    if (!isInstantEvalField(field)) return;
    if (node.expression.type !== "LiteralExpression") return;
    const question = String(node.expression.value).trim();
    if (question.length === 0) return;
    chips.push({ question, field, target: instantEvalTargetOf({ fieldName: field, lensId }) });
  });
  return chips;
}

/** The query with every eval chip removed: the scope a run judges. */
export function queryWithoutInstantEvalChips(queryText: string): string {
  const trimmed = queryText.trim();
  if (!trimmed) return "";
  let ast: LiqeQuery;
  try {
    ast = parse(trimmed);
  } catch {
    return trimmed;
  }
  const next = filterAST(
    ast,
    (node) =>
      !(
        node.type === "Tag" &&
        node.field.type !== "ImplicitField" &&
        isInstantEvalField(node.field.name)
      ),
  );
  return isEmptyAST(next) ? "" : serialize(next);
}

/**
 * The chip text for a question: the bare field when the target is what the lens
 * judges anyway, the forcing spelling when it is not. Always quoted — a chip
 * that is sometimes bare reads as a different kind of filter.
 */
export function instantEvalChipText({
  question,
  target,
  lensId,
}: {
  question: string;
  target: InstantEvalTarget;
  lensId: string | undefined;
}): string {
  const field =
    target === instantEvalTargetForLens(lensId)
      ? INSTANT_EVAL_FIELD
      : (Object.entries(INSTANT_EVAL_TARGET_FIELDS).find(
          ([, candidate]) => candidate === target,
        )?.[0] ?? INSTANT_EVAL_FIELD);
  const collapsed = question.replace(/\s+/g, " ").trim();
  return `${field}:"${collapsed.replace(/[\\"]/g, "\\$&")}"`;
}

/** The window half of a run key: a preset by its id, an absolute range by its bounds. */
export function instantEvalWindowKey(window: {
  from: number;
  to: number;
  presetId?: string;
}): string {
  return window.presetId ? `preset:${window.presetId}` : `${window.from}-${window.to}`;
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
 * The key a run is registered under: the question, the unit judged, the other
 * chips and the window. Any change to one of them is a different key, and
 * therefore a different run started through the cost rule.
 */
export function instantEvalRunKey({
  question,
  target,
  otherQuery,
  window,
}: {
  question: string;
  target: InstantEvalTarget;
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

/**
 * One run a chip names, checked against the project and dated in epoch
 * milliseconds, as the compiler binds it.
 */
export interface ResolvedInstantEvalRun extends InstantEvalRunReference {
  /** When the run's judgements started being written. */
  readonly writtenFrom: number;
  /** When the last of them could have been written. */
  readonly writtenUntil: number;
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
