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
    const definition = lwqlAppFunction(call.function);
    if (!definition) {
      // Not a customer-facing condition: the validator only admits names from
      // this same catalog, so a plan naming something else is our bug and must
      // degrade to "unknown" rather than wear a handled code (ADR-045).
      throw new Error(
        `lwql hydration: the plan names "${call.function}", which is not an app function`,
      );
    }
    const keys = new Map<string, readonly string[]>();
    for (const row of rows) {
      const parts = appFunctionKeyParts(row[call.column]);
      if (!parts) continue;
      keys.set(appFunctionKeyId(parts), parts);
    }
    return { call, definition, keys };
  });
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
}

/** Adds one call's keys to the running sets. */
function addCallKeys({
  call,
  into,
}: {
  call: ResolvedCall;
  into: DistinctKeys;
}) {
  const kind = call.definition.keyKind;
  for (const [keyId, parts] of call.keys) {
    const [first] = parts;
    if (first === undefined) continue;
    if (kind === "thread") into.threadKeys.add(first);
    else into.traceIds.add(first);
    if (kind === "span") into.spanPairs.add(keyId);
  }
}

export function distinctKeys(resolved: readonly ResolvedCall[]): DistinctKeys {
  const keys: DistinctKeys = {
    traceIds: new Set(),
    threadKeys: new Set(),
    spanPairs: new Set(),
  };
  for (const call of resolved) addCallKeys({ call, into: keys });
  return keys;
}

function distinctKeyCounts(
  resolved: readonly ResolvedCall[],
): Record<LangWatchQLAppFunctionKeyKind, number> {
  const { traceIds, threadKeys, spanPairs } = distinctKeys(resolved);
  return {
    trace: traceIds.size,
    thread: threadKeys.size,
    span: spanPairs.size,
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
      functions: resolved
        .filter((entry) => entry.definition.keyKind === keyKind)
        .map((entry) => entry.definition.name),
    });
  }
}
