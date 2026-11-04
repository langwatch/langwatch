/**
 * Who wrote a LangWatchQL statement, told by its text and never by its error code.
 * @see specs/lwql/query-origin.feature
 */

export type LangWatchQLOrigin = "built_in" | "user_written";

/** sha256 hex of `sql` exactly as sent: no trimming, so a changed byte is a different statement. */
export function hashStatement(_input: { sql: string }): string {
  throw new Error("not implemented");
}

/** `built_in` when the statement's hash is on the generated list, else `user_written`. */
export function originOfStatement(_input: { sql: string }): LangWatchQLOrigin {
  throw new Error("not implemented");
}
