/**
 * Steps 1 and 2 of the hydration stage: which keys a finished result needs,
 * and whether one execution is allowed to read that many.
 * @see specs/lwql/app-functions.feature
 */

import type { LangWatchQLAppFunctionCall } from "@langwatch/analytics-contract";
import { LangWatchQLAppFunctionKeyCapError } from "@langwatch/analytics-contract";

import { findLangWatchQLAppFunctions } from "./langwatch-ql-app-function-catalog.rules.ts";
import {
  appFunctionKeyId,
  findAppFunctionKeyParts,
} from "./langwatch-ql-app-function-keys.rules.ts";
import {
  LWQL_APP_FUNCTION_KEY_CAPS,
  type LangWatchQLAppFunctionDefinition,
  type LangWatchQLAppFunctionKeyKind,
} from "./langwatch-ql-app-function-shapes.rules.ts";

/** A call, with the catalogue entry it names and the keys its column carries. */
export interface LangWatchQLResolvedCall {
  readonly call: LangWatchQLAppFunctionCall;
  readonly definition: LangWatchQLAppFunctionDefinition;
  /**
   * The extraction this call judges, for an eval written over one. When it is
   * present the key in the column belongs to that extraction, so the read, the
   * cap and the computed text all follow it.
   */
  readonly source?: LangWatchQLAppFunctionDefinition;
  /** The source's kind where there is one, otherwise the definition's own. */
  readonly keyKind: LangWatchQLAppFunctionKeyKind;
  /** Distinct keys this call needs, by {@link appFunctionKeyId}. */
  readonly keys: ReadonlyMap<string, readonly string[]>;
}

/** One computed value, and whether the per-value ceiling cut it. */
export interface LangWatchQLComputedValue {
  /** A number for a judged column, text or a list for an extracted one. */
  readonly value: string | number | readonly string[] | null;
  readonly isTruncated: boolean;
  /** False when the key named no trace, thread or span at all. */
  readonly isResolved: boolean;
}

/** Every call's values, by output column and then by key id. */
export type LangWatchQLComputedValues = ReadonlyMap<
  string,
  ReadonlyMap<string, LangWatchQLComputedValue>
>;

export const LWQL_NOT_RESOLVED: LangWatchQLComputedValue = {
  value: null,
  isTruncated: false,
  isResolved: false,
};

/**
 * The extraction half of a judged plan: an eval written over an extraction
 * becomes that extraction in the same column, and an eval written over a plain
 * expression is dropped, because the identity UDF already left the text there.
 */
export function langWatchQLExtractionPlan(
  calls: readonly LangWatchQLAppFunctionCall[],
): readonly LangWatchQLAppFunctionCall[] {
  const plan: LangWatchQLAppFunctionCall[] = [];
  for (const call of calls) {
    const [definition] = findLangWatchQLAppFunctions(call.function);
    if (!definition) continue;
    if (definition.kind !== "eval") {
      plan.push(call);
      continue;
    }
    if (!call.source) continue;
    plan.push({
      column: call.column,
      function: call.source.function,
      options: call.source.options,
    });
  }
  return plan;
}

/**
 * The catalogue entry a plan names. Not a customer-facing condition: the
 * validator admits names from this same catalogue, so a plan naming something
 * else is our bug and degrades to "unknown" rather than wearing a code.
 */
function declaredFunction({
  name,
  role,
}: {
  name: string;
  role: "names" | "nests";
}): LangWatchQLAppFunctionDefinition {
  const [definition] = findLangWatchQLAppFunctions(name);
  if (!definition) {
    throw new Error(`lwql hydration: the plan ${role} "${name}", which is not an app function`);
  }
  return definition;
}

/** Every distinct key one column carries, by {@link appFunctionKeyId}. */
function distinctColumnKeys({
  column,
  rows,
}: {
  column: string;
  rows: readonly Record<string, unknown>[];
}): ReadonlyMap<string, readonly string[]> {
  const keys = new Map<string, readonly string[]>();
  for (const row of rows) {
    const parts = findAppFunctionKeyParts(row[column]);
    if (parts.length === 0) continue;
    keys.set(appFunctionKeyId(parts), parts);
  }
  return keys;
}

/**
 * Step 1: the distinct keys each call needs. Distinct, because a query
 * grouping ten thousand rows onto two hundred conversations costs two hundred
 * reads, not ten thousand.
 */
export function collectLangWatchQLKeys({
  calls,
  rows,
}: {
  calls: readonly LangWatchQLAppFunctionCall[];
  rows: readonly Record<string, unknown>[];
}): readonly LangWatchQLResolvedCall[] {
  return calls.map((call) => {
    const definition = declaredFunction({ name: call.function, role: "names" });
    const source = call.source
      ? declaredFunction({ name: call.source.function, role: "nests" })
      : undefined;
    return {
      call,
      definition,
      ...(source ? { source } : {}),
      keyKind: source?.keyKind ?? definition.keyKind,
      keys: distinctColumnKeys({ column: call.column, rows }),
    };
  });
}

/** The distinct keys of each kind one execution needs, counted across calls. */
export interface LangWatchQLDistinctKeys {
  /** First key part of every trace- and span-keyed call. */
  readonly traceIds: ReadonlySet<string>;
  readonly threadKeys: ReadonlySet<string>;
  /** Whole key id of every span-keyed call, so a pair counts once. */
  readonly spanPairs: ReadonlySet<string>;
  /** Texts judged straight from the column, which are read from nothing. */
  readonly texts: ReadonlySet<string>;
}

interface MutableDistinctKeys {
  readonly traceIds: Set<string>;
  readonly threadKeys: Set<string>;
  readonly spanPairs: Set<string>;
  readonly texts: Set<string>;
}

/** Adds one call's keys to the running sets. */
function addCallKeys({
  call,
  into,
}: {
  call: LangWatchQLResolvedCall;
  into: MutableDistinctKeys;
}): void {
  const kind = call.keyKind;
  for (const [keyId, parts] of call.keys) {
    const [first] = parts;
    if (first === undefined) continue;
    if (kind === "thread") into.threadKeys.add(first);
    else if (kind === "text") into.texts.add(first);
    else into.traceIds.add(first);
    if (kind === "span") into.spanPairs.add(keyId);
  }
}

/**
 * Counted across every call rather than per call, because the fetch is shared.
 * A span-keyed call contributes its trace ids to the trace count, since
 * resolving a span means reading its trace.
 */
export function langWatchQLDistinctKeys(
  resolved: readonly LangWatchQLResolvedCall[],
): LangWatchQLDistinctKeys {
  const keys: MutableDistinctKeys = {
    traceIds: new Set(),
    threadKeys: new Set(),
    spanPairs: new Set(),
    texts: new Set(),
  };
  for (const call of resolved) addCallKeys({ call, into: keys });
  return keys;
}

function distinctKeyCounts(
  resolved: readonly LangWatchQLResolvedCall[],
): Record<LangWatchQLAppFunctionKeyKind, number> {
  const { traceIds, threadKeys, spanPairs, texts } = langWatchQLDistinctKeys(resolved);
  return {
    trace: traceIds.size,
    thread: threadKeys.size,
    span: spanPairs.size,
    text: texts.size,
  };
}

/**
 * The functions whose keys were counted against one cap, each named once. A
 * span-keyed call reads its trace, so leaving it out of the trace-cap refusal
 * would name only some of the calls that cost it.
 */
function functionsCountedAgainst({
  keyKind,
  resolved,
}: {
  keyKind: LangWatchQLAppFunctionKeyKind;
  resolved: readonly LangWatchQLResolvedCall[];
}): readonly string[] {
  const isCounted = (entry: LangWatchQLResolvedCall) =>
    entry.keyKind === keyKind || (keyKind === "trace" && entry.keyKind === "span");
  const names = new Set(resolved.filter(isCounted).map((entry) => entry.definition.name));

  return [...names].toSorted();
}

/**
 * Step 2: the caps, before anything is read. A cap breach is a refusal rather
 * than a partial answer — a result that hydrated the first thousand keys and
 * left the rest as raw ids would look complete and be wrong.
 */
export function assertLangWatchQLKeyCaps(resolved: readonly LangWatchQLResolvedCall[]): void {
  const counts = distinctKeyCounts(resolved);
  for (const [keyKind, cap] of Object.entries(LWQL_APP_FUNCTION_KEY_CAPS) as [
    LangWatchQLAppFunctionKeyKind,
    number,
  ][]) {
    const distinct = counts[keyKind];
    if (distinct <= cap) continue;
    throw new LangWatchQLAppFunctionKeyCapError({
      keyKind,
      cap,
      distinct,
      functions: functionsCountedAgainst({ keyKind, resolved }),
    });
  }
}
