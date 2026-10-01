import { parse } from "@langwatch/ksuid";

function secondOf(id: string): number | undefined {
  try {
    return parse(id).timestamp;
  } catch {
    // An id that is not a KSUID is never proof of freshness.
    return undefined;
  }
}

/**
 * Whether a read answer has caught up with a hint. KSUIDs order only to the
 * second, so inside the hint's second only the hint's own id proves it.
 * Spec: packages/eventing/specs/projection-cursor-reads.feature
 */
export function isFresh({ answerId, hintId }: { answerId: string; hintId: string }): boolean {
  const answerSecond = secondOf(answerId);
  const hintSecond = secondOf(hintId);
  if (answerSecond === undefined || hintSecond === undefined) return false;
  if (answerSecond === hintSecond) return answerId === hintId;
  return answerSecond > hintSecond;
}
