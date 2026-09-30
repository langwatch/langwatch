/**
 * Step 1 and 2 of the hydration stage: which keys the run needs, and whether
 * it is allowed to read that many.
 *
 * @see ../hydrate.ts
 */

import { LangWatchQLAppFunctionKeyCapError } from "../../errors";
import {
  type LangWatchQLAppFunctionKeyKind,
  LWQL_APP_FUNCTION_KEY_CAPS,
  lwqlAppFunction,
} from "../catalog";
import { appFunctionKeyId, appFunctionKeyParts } from "../keys";
import type { LangWatchQLHydrationInput, ResolvedCall } from "./contract";

// ---------------------------------------------------------------------------
// Step 1 — the distinct keys each call needs
// ---------------------------------------------------------------------------

export function collectKeys({
  calls,
  rows,
}: Pick<LangWatchQLHydrationInput, "calls" | "rows">): ResolvedCall[] {
  return calls.map((call) => {
    const definition = declaredFunction({ name: call.function, role: "names" });
    const source = call.source
      ? declaredFunction({ name: call.source.function, role: "nests" })
      : undefined;
    return {
      call,
      definition,
      ...(source ? { source } : {}),
      // The key in the column belongs to whichever function is innermost, so
      // an eval over an extraction is read, capped and computed as that
      // extraction. An eval over a plain column keeps its own `text` kind,
      // which reads nothing.
      keyKind: source?.keyKind ?? definition.keyKind,
      keys: distinctColumnKeys({ column: call.column, rows }),
    };
  });
}

/**
 * The catalog entry a plan names.
 *
 * Not a customer-facing condition: the validator only admits names from this
 * same catalog, so a plan naming something else is our bug and must degrade to
 * "unknown" rather than wear a handled code (ADR-045).
 */
function declaredFunction({
  name,
  role,
}: {
  name: string;
  role: "names" | "nests";
}) {
  const definition = lwqlAppFunction(name);
  if (!definition) {
    throw new Error(
      `lwql hydration: the plan ${role} "${name}", which is not an app function`,
    );
  }
  return definition;
}

/** Every distinct key one column carries, keyed by {@link appFunctionKeyId}. */
function distinctColumnKeys({
  column,
  rows,
}: {
  column: string;
  rows: readonly Record<string, unknown>[];
}): Map<string, readonly string[]> {
  const keys = new Map<string, readonly string[]>();
  for (const row of rows) {
    const parts = appFunctionKeyParts(row[column]);
    if (!parts) continue;
    keys.set(appFunctionKeyId(parts), parts);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Step 2 — the caps, before anything is read
// ---------------------------------------------------------------------------

/**
 * The distinct keys of each kind this execution needs.
 *
 * Counted across every call rather than per call, because the fetch is shared:
 * three functions over one set of trace ids is one read of that set, and
 * charging each of them separately against the cap would refuse a query that
 * costs no more than a single-function one. The span kind contributes its trace
 * ids to the trace count as well, since resolving a span means reading its
 * trace.
 */
interface DistinctKeys {
  /** First key part of every trace- and span-keyed call. */
  readonly traceIds: Set<string>;
  readonly threadKeys: Set<string>;
  /** Whole key id of every span-keyed call, so a pair counts once. */
  readonly spanPairs: Set<string>;
  /** Texts judged straight from the column, which are read from nothing. */
  readonly texts: Set<string>;
}

/** Adds one call's keys to the running sets. */
function addCallKeys({
  call,
  into,
}: {
  call: ResolvedCall;
  into: DistinctKeys;
}) {
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

export function distinctKeys(resolved: readonly ResolvedCall[]): DistinctKeys {
  const keys: DistinctKeys = {
    traceIds: new Set(),
    threadKeys: new Set(),
    spanPairs: new Set(),
    texts: new Set(),
  };
  for (const call of resolved) addCallKeys({ call, into: keys });
  return keys;
}

function distinctKeyCounts(
  resolved: readonly ResolvedCall[],
): Record<LangWatchQLAppFunctionKeyKind, number> {
  const { traceIds, threadKeys, spanPairs, texts } = distinctKeys(resolved);
  return {
    trace: traceIds.size,
    thread: threadKeys.size,
    span: spanPairs.size,
    text: texts.size,
  };
}

export function assertKeyCaps(resolved: readonly ResolvedCall[]): void {
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

/**
 * The functions whose keys were counted against one cap, each named once.
 *
 * A span-keyed call reads its trace, so its trace ids sit in the trace count
 * (see {@link addCallKeys}); leaving it out of the trace-cap error would name
 * only some of the calls that cost it.
 */
function functionsCountedAgainst({
  keyKind,
  resolved,
}: {
  keyKind: LangWatchQLAppFunctionKeyKind;
  resolved: readonly ResolvedCall[];
}): string[] {
  const isCounted = (entry: ResolvedCall) =>
    entry.keyKind === keyKind ||
    (keyKind === "trace" && entry.keyKind === "span");
  const names = new Set(
    resolved.filter(isCounted).map((entry) => entry.definition.name),
  );
  return [...names].sort();
}
