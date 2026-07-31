/**
 * LWQL errors.
 *
 * Issue #6346 UX requirement: errors explain what was invalid *and how to fix
 * it*. Every construction site here is expected to supply a `hint` — a message
 * that only names the problem makes the language feel like a guessing game,
 * which is the specific failure a constrained language is supposed to avoid.
 */

export type LwqlErrorCode =
  | "parse_error"
  | "unknown_entity"
  | "unknown_field"
  | "unknown_function"
  | "type_mismatch"
  | "content_gated"
  | "invalid_query"
  | "limit_exceeded";

export class LwqlError extends Error {
  readonly code: LwqlErrorCode;
  readonly hint?: string;
  /** Character offset into the query text, when the error came from the parser. */
  readonly position?: number;

  constructor(
    code: LwqlErrorCode,
    message: string,
    options: { hint?: string; position?: number } = {},
  ) {
    super(message);
    this.name = "LwqlError";
    this.code = code;
    this.hint = options.hint;
    this.position = options.position;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint !== undefined ? { hint: this.hint } : {}),
      ...(this.position !== undefined ? { position: this.position } : {}),
    };
  }
}

/**
 * Suggests the closest allowlisted name, so a typo produces a fix rather than a
 * list of 20 fields. Plain Levenshtein, capped — the candidate sets are small
 * and this runs once per failed compile.
 */
export const closestMatch = (
  input: string,
  candidates: readonly string[],
  maxDistance = 3,
): string | undefined => {
  let best: string | undefined;
  let bestDistance = maxDistance + 1;

  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= maxDistance ? best : undefined;
};

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      current.push(
        Math.min(current[j]! + 1, previous[j + 1]! + 1, previous[j]! + cost),
      );
    }
    previous = current;
  }

  return previous[b.length]!;
};

/** Builds an `unknown_field` error carrying a did-you-mean hint. */
export const unknownFieldError = (
  field: string,
  entity: string,
  available: readonly string[],
): LwqlError => {
  const suggestion = closestMatch(field, available);
  return new LwqlError(
    "unknown_field",
    `Unknown field '${field}' on '${entity}'.`,
    {
      hint: suggestion
        ? `Did you mean '${suggestion}'?`
        : `Available fields: ${available.slice(0, 15).join(", ")}${
            available.length > 15 ? ", …" : ""
          }.`,
    },
  );
};
