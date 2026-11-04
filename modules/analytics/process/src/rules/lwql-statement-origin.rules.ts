/**
 * Who wrote a LangWatchQL statement, told by its text and never by its error code.
 * @see specs/lwql/query-origin.feature
 */
import { createHash } from "node:crypto";

import { LWQL_BUILTIN_STATEMENT_HASHES } from "./lwql-builtin-statements.generated.ts";

export type LangWatchQLOrigin = "built_in" | "user_written";

const BUILTIN_HASHES: ReadonlySet<string> = new Set(LWQL_BUILTIN_STATEMENT_HASHES);

/** sha256 hex of `sql` exactly as sent: no trimming, so a changed byte is a different statement. */
export function hashStatement({ sql }: { sql: string }): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** `built_in` when the statement's hash is on the generated list, else `user_written`. */
export function originOfStatement({ sql }: { sql: string }): LangWatchQLOrigin {
  return BUILTIN_HASHES.has(hashStatement({ sql })) ? "built_in" : "user_written";
}
