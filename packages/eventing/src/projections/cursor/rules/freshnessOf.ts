import { parse } from "@langwatch/ksuid";

/**
 * Which cursor an answer carries: the hint's own aggregate row (projection, key), or the
 * tenant row. Only the aggregate row can prove the hint's event applied; the tenant row is a
 * max id, not a watermark.
 */
export type CursorScope = "aggregate" | "tenant";

/** `fresh` proves the hint's event is in; `approximate` only that the cursor passed it. */
export type Freshness = "fresh" | "approximate" | "stale";

function secondOf(id: string): number | undefined {
  try {
    return parse(id).timestamp;
  } catch {
    // An id that is not a KSUID is never proof of freshness.
    return undefined;
  }
}

/** KSUIDs order only to the second, so inside the hint's second only its own id passes it. */
function hasPassed({ answerId, hintId }: { answerId: string; hintId: string }): boolean {
  const answerSecond = secondOf(answerId);
  const hintSecond = secondOf(hintId);
  if (answerSecond === undefined || hintSecond === undefined) return false;
  if (answerSecond === hintSecond) return answerId === hintId;
  return answerSecond > hintSecond;
}

/**
 * Whether a read answer has caught up with a hint (ARCHITECTURE.md "Projection cursor
 * reads"). A tenant-wide answer is never `fresh`.
 * Spec: packages/eventing/specs/projection-cursor-reads.feature
 */
export function freshnessOf({
  answerId,
  hintId,
  scope,
}: {
  answerId: string;
  hintId: string;
  scope: CursorScope;
}): Freshness {
  if (!hasPassed({ answerId, hintId })) return "stale";
  return scope === "aggregate" ? "fresh" : "approximate";
}
