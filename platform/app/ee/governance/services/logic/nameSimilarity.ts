// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Scoring how much two name texts resemble each other (ADR-128 §12).
 *
 * BACKGROUND JOB ONLY. Nothing that answers an HTTP request may reach this
 * file, and a test walks the import graph to prove it
 * (`identityScorerRequestBoundary.unit.test.ts`). The reason is measured rather
 * than stylistic: this is quadratic in the two populations, there is no
 * database route to it here — the repo has no `pg_trgm` in 297 migrations and
 * no edit-distance library in its dependencies — so it runs on our own event
 * loop. At ADR-128's own example size, 2,000 discovered people against 500
 * accounts, the million pairs measured 2.9 seconds of blocking. Per page load,
 * uncached, stalling every other request on the instance.
 *
 * Which is what the prefilter is for. Edit distance is the expensive half, so
 * pairs are thrown out by two cheap tests first, and only survivors are scored.
 * A guess never links anybody either way (`identityEvidence.ts` owns that
 * rule); the worst a wrong score does is put a bad candidate in a review queue.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 */

/**
 * How far apart two names may be in length and still be worth comparing, as a
 * fraction of the longer one.
 *
 * Edit distance is bounded below by the length difference, so a pair outside
 * this band cannot score above the threshold anyway — the band is not a
 * heuristic on top of the score, it is the score's own arithmetic, applied
 * before paying for it. At 0.4 it admits "m.silva" against "maria silva"
 * (7 against 11, a difference of 0.36) and rejects a first name against a full
 * legal name with three middles.
 */
export const LENGTH_BAND = 0.4;

/**
 * Below this, a candidate is not worth a human's attention.
 *
 * A review queue nobody finishes is a review queue nobody uses, and every row
 * here costs somebody a decision. Set where "m.silva" against "maria silva"
 * survives and two unrelated names do not.
 */
export const SUGGESTION_THRESHOLD = 0.6;

/**
 * The words a name is made of: lowercased, split on anything that is not a
 * letter or a digit, single characters dropped.
 *
 * Single characters go because a middle initial shared by two unrelated people
 * is not a signal, and admitting it would make the shared-token prefilter
 * admit most of the population — which is the same as having no prefilter.
 */
export function nameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

/**
 * The part of a text that names a person: the local part of an address, with
 * case and punctuation flattened.
 *
 * Both sides arrive as addresses often enough that this is the difference
 * between the engine working and not working at all. `DiscoveredPerson.displayText`
 * IS an address for two of the three providers `identityEvidence.ts` handles —
 * Databricks puts it in the id field, OpenAI in `user_email` — and on the account
 * side `OrganizationAccountDirectoryRepository.findMemberNames` falls back to
 * `user.email` for any member with no display name.
 *
 * Leaving the domain on breaks the pass in both directions, measured at
 * ADR-128's own 2,000 x 500:
 *
 *  - address against display name — 1,000,000 pairs, **0** admitted. The domain
 *    is dead weight on one side only, so the length band rejects every pair and
 *    the engine produces nothing at all.
 *  - address against address — 1,000,000 pairs, **all** admitted, 978,373 over
 *    threshold, 9.1s of blocked event loop. The shared corporate domain is a
 *    token every pair has, which is the same as having no prefilter, and it pads
 *    both strings with identical characters, which inflates every score.
 *
 * The domain is not evidence anyway: everybody in one organization shares it, so
 * it distinguishes nobody. Split at the LAST `@` so an address is cut in the one
 * place it can be, and only when something precedes it — a text that begins with
 * `@` is a handle rather than an address, and cutting there would leave nothing
 * at all to compare.
 */
export function comparableName(text: string): string {
  const at = text.lastIndexOf("@");
  const local = at > 0 ? text.slice(0, at) : text;
  return local
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The prefilter proper, on text that has already been through
 * `comparableName`.
 *
 * Separate from the exported wrapper so that `nameSimilarity` pays for the
 * normalization once per pair rather than twice — at a million pairs the
 * difference is not academic.
 */
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

/**
 * Whether a pair is worth scoring at all.
 *
 * Two tests, both cheap, both required. The length band is edit distance's own
 * lower bound applied early; the shared token is what stops the pass being
 * quadratic in practice, since two names drawn from an organization's roster
 * almost never share a word by accident.
 *
 * Deliberately not a substring test: "an" appearing in both "Daniel" and
 * "Alexandra" would admit the pair, and admitting most pairs is the failure
 * mode this function exists to avoid.
 */
export function isWorthScoring(left: string, right: string): boolean {
  return isWorthComparing(comparableName(left), comparableName(right));
}

/**
 * One row of the Levenshtein matrix, given the row above it.
 *
 * Writes into `current` rather than returning a new array: the caller swaps the
 * two buffers each row, so the whole distance costs two allocations however
 * long the names are.
 */
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
    // Every index below is in range by the loop bounds; the `?? 0` is this
    // codebase's indexed-access typing, not a case that can happen.
    const substitution =
      (previous[column - 1] ?? 0) +
      (left[row - 1] === right[column - 1] ? 0 : 1);
    current[column] = Math.min(
      substitution,
      (previous[column] ?? 0) + 1,
      (current[column - 1] ?? 0) + 1,
    );
  }
}

/**
 * Levenshtein distance, two rows rather than a full matrix.
 *
 * The whole matrix is O(n·m) memory for an answer that only ever reads the row
 * above, and this runs over however many pairs survive the prefilter.
 */
function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  let current = new Array<number>(right.length + 1);

  for (let row = 1; row <= left.length; row++) {
    fillDistanceRow({ previous, current, left, right, row });
    [previous, current] = [current, previous];
  }

  return previous[right.length] ?? 0;
}

/**
 * How alike two names are, in [0, 1], or null when the pair was not worth
 * comparing.
 *
 * Null rather than 0 on purpose: "we did not look" and "we looked and they are
 * nothing alike" are different facts, and a caller that cannot tell them apart
 * cannot report how much work the prefilter saved.
 *
 * Case, punctuation and any mail domain are normalized away before comparing,
 * so `M.Silva@acme.com` and `m silva` are the same text rather than two thirds
 * of an edit apart.
 */
export function nameSimilarity(left: string, right: string): number | null {
  const a = comparableName(left);
  const b = comparableName(right);
  if (!isWorthComparing(a, b)) return null;

  const longer = Math.max(a.length, b.length);
  if (longer === 0) return null;
  return 1 - editDistance(a, b) / longer;
}
