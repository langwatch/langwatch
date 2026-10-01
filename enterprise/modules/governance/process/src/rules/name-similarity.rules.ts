// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Names whose lengths differ by more than this share of the longer are never compared. */
export const LENGTH_BAND = 0.4;

/** The score a pair must reach to be put to a reviewer (ADR-128 §12). */
export const SUGGESTION_THRESHOLD = 0.6;

export function nameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

/** An address's local part, or the whole text, lowercased with punctuation as spaces. */
export function comparableName(text: string): string {
  const at = text.lastIndexOf("@");
  const local = at > 0 ? text.slice(0, at) : text;
  return local
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isWorthComparing(left: string, right: string): boolean {
  const longer = Math.max(left.length, right.length);
  if (longer === 0) return false;
  if (Math.abs(left.length - right.length) / longer > LENGTH_BAND) return false;

  const leftTokens = nameTokens(left);
  if (leftTokens.size === 0) return false;
  for (const token of nameTokens(right)) {
    if (leftTokens.has(token)) return true;
  }
  return false;
}

/** The cheap prefilter: a similar length and one shared token, before any edit distance is paid. */
export function isWorthScoring(left: string, right: string): boolean {
  return isWorthComparing(comparableName(left), comparableName(right));
}

function fillDistanceRow({
  previous,
  current,
  left,
  right,
  row,
}: {
  previous: number[];
  current: number[];
  left: string;
  right: string;
  row: number;
}): void {
  current[0] = row;
  for (let column = 1; column <= right.length; column++) {
    const substitution =
      (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1);
    current[column] = Math.min(
      substitution,
      (previous[column] ?? 0) + 1,
      (current[column - 1] ?? 0) + 1,
    );
  }
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  let current = Array.from({ length: right.length + 1 }, () => 0);

  for (let row = 1; row <= left.length; row++) {
    fillDistanceRow({ previous, current, left, right, row });
    [previous, current] = [current, previous];
  }

  return previous[right.length] ?? 0;
}

/** A pair the prefilter refused is not a zero score: nothing was compared. */
export type NameSimilarity = { outcome: "not_compared" } | { outcome: "scored"; score: number };

/**
 * One minus the normalized edit distance, when the prefilter admits the pair.
 * Background only: the pair sweep is too slow for a request path (ADR-128 §12).
 */
export function nameSimilarity(left: string, right: string): NameSimilarity {
  const a = comparableName(left);
  const b = comparableName(right);
  if (!isWorthComparing(a, b)) return { outcome: "not_compared" };

  const longer = Math.max(a.length, b.length);
  if (longer === 0) return { outcome: "not_compared" };
  return { outcome: "scored", score: 1 - editDistance(a, b) / longer };
}
