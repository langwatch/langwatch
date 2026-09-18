/**
 * LWQL errors.
 *
 * Issue #6346 UX requirement: errors explain what was invalid *and how to fix
 * it*. Every construction site here is expected to supply a `hint` — a message
 * that only names the problem makes the language feel like a guessing game,
 * which is the specific failure a constrained language is supposed to avoid.
 *
 * The `unknown*Error` constructors are shared by the text front-end and the
 * compiler on purpose. Both reject the same names — the front-end so that user
 * text never reaches the IR as an identifier, the compiler so that a caller
 * posting IR directly is held to the same allowlist — and a message that
 * differed between the two entrances would read as two different languages.
 */

import { distance } from "fastest-levenshtein";

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
 * list of 20 fields. Capped — the candidate sets are small and this runs once
 * per failed parse or compile.
 *
 * ADR-081 decision 9: the edit distance itself comes from `fastest-levenshtein`
 * rather than a hand-rolled matrix. A suggestion helper is not a place to keep
 * bespoke code.
 */
export const closestMatch = (
  input: string,
  candidates: readonly string[],
  maxDistance = 3,
): string | undefined => {
  let best: string | undefined;
  let bestDistance = maxDistance + 1;

  for (const candidate of candidates) {
    const candidateDistance = distance(input, candidate);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      best = candidate;
    }
  }

  return bestDistance <= maxDistance ? best : undefined;
};

/** "Did you mean …", or the allowlist itself when nothing is close enough. */
const suggestionHint = (
  input: string,
  available: readonly string[],
  noun: string,
): string => {
  const suggestion = closestMatch(input, available);
  if (suggestion) return `Did you mean '${suggestion}'?`;

  return `Available ${noun}: ${available.slice(0, 15).join(", ")}${
    available.length > 15 ? ", …" : ""
  }.`;
};

/** Builds an `unknown_field` error carrying a did-you-mean hint. */
export const unknownFieldError = (
  field: string,
  entity: string,
  available: readonly string[],
): LwqlError =>
  new LwqlError("unknown_field", `Unknown field '${field}' on '${entity}'.`, {
    hint: suggestionHint(field, available, "fields"),
  });

/** Builds an `unknown_entity` error carrying a did-you-mean hint. */
export const unknownEntityError = (
  entity: string,
  available: readonly string[],
): LwqlError =>
  new LwqlError("unknown_entity", `Unknown entity '${entity}'.`, {
    hint: suggestionHint(entity, available, "entities"),
  });

/**
 * Builds an `unknown_function` error carrying a did-you-mean hint.
 *
 * `shown` is the caller's own spelling; matching is case-insensitive, as in SQL,
 * so the suggestion is computed from the normalised form.
 */
export const unknownFunctionError = (
  shown: string,
  available: readonly string[],
): LwqlError =>
  new LwqlError("unknown_function", `Unknown function '${shown}'.`, {
    hint: suggestionHint(shown.toLowerCase(), available, "functions"),
  });
