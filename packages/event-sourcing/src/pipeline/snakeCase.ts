/**
 * camelCase → snake_case, at both the runtime and the type level, so a derived
 * event type string is byte-identical to the legacy dotted one already in
 * `event_log` (ADR-105 decision 3).
 *
 * One left-to-right scan with a character of lookahead: a boundary before a
 * capital following a lowercase letter or digit, and before the last capital of
 * a run when a lowercase letter follows it (`parseHTMLDoc` → `parse_html_doc`).
 */

/** Is `C` an uppercase letter? A digit or symbol is neither upper nor lower
 * under this test (`Uppercase`/`Lowercase` are no-ops on non-letters, so both
 * comparisons succeed and the digit/symbol branch is chosen), which is what
 * keeps a digit run from being treated as a word-starting capital. */
type IsUpper<C extends string> =
  C extends Uppercase<C> ? (C extends Lowercase<C> ? false : true) : false;

/**
 * The single-pass walk. `PrevWasLower` is whether the character just
 * emitted was lowercase or a digit — the signal for the plain "boundary
 * before a capital" case. The acronym case additionally needs one character
 * of lookahead (`C2`), because "does this run of capitals end here" can only
 * be answered by the character after it.
 */
type SnakeWalk<
  S extends string,
  PrevWasLower extends boolean,
  Acc extends string,
> = S extends `${infer C1}${infer Rest}`
  ? IsUpper<C1> extends true
    ? Rest extends `${infer C2}${string}`
      ? PrevWasLower extends true
        ? SnakeWalk<Rest, false, `${Acc}_${Lowercase<C1>}`>
        : IsUpper<C2> extends false
          ? SnakeWalk<Rest, false, `${Acc}_${Lowercase<C1>}`>
          : SnakeWalk<Rest, false, `${Acc}${Lowercase<C1>}`>
      : PrevWasLower extends true
        ? `${Acc}_${Lowercase<C1>}`
        : `${Acc}${Lowercase<C1>}`
    : SnakeWalk<Rest, true, `${Acc}${C1}`>
  : Acc;

/**
 * The type-level half, so `event.type` narrows on the exact literal the runtime
 * produces. It recurses over one identifier's characters rather than over the
 * event union, so N of them stay linear in N (ADR-105 rationale, "Type-level
 * cost is a real constraint").
 */
export type CamelToSnake<S extends string> = SnakeWalk<S, false, "">;

/** The runtime counterpart of `CamelToSnake`, computing the same string. */
export function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}
