/**
 * LangWatchQL app functions — the hydration plan the validator records.
 *
 * One entry per admitted call: which output column carries the key, which
 * function was called, and the literal options it was called with. That is
 * everything hydration needs, because the *key* travels in the column itself —
 * the database's projection UDF put it there.
 *
 * Recorded by the validator's single walk rather than re-read later, for the
 * same reason the diagnostics read that walk's record (ADR-083): a second
 * parse is a second answer waiting to disagree with the first, and here the
 * two answers would be "what does this column mean", which cannot be allowed
 * to differ.
 *
 * Its own module so `../validation/validate.ts` can record a plan without
 * importing the hydrator, and the hydrator can read one without importing the
 * validator.
 *
 * @see ./hydrate.ts — what reads this
 * @see ../validation/validate.ts — what writes it
 */

/** One admitted app-function call in the outermost projection. */
export interface LangWatchQLAppFunctionCall {
  /**
   * The output column the call's value lands in, which is the alias the caller
   * was required to write. Required precisely so hydration never has to parse
   * a column name like `conversation(ConversationId)` back into a call.
   */
  readonly column: string;
  /** The catalogued function name, lowercased. */
  readonly function: string;
  /**
   * The literal option values, in declared order — `[]` for a function that
   * takes only a key. Options are literals so this is a property of the
   * statement, knowable before a single row comes back.
   */
  readonly options: readonly (string | number)[];
}
