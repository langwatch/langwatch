// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether `pollerCursor` holds a real cursor.
 *
 * `pollerCursor` is `Json?`, and the write path stores either `Prisma.JsonNull`
 * or a string — see ingestion-pull-run-projection.prisma.repository.ts. Both
 * SQL NULL and JSON null read back as JS `null`, so `!= null` would be correct
 * for everything that writer produces.
 *
 * It is not the only thing that has produced values here: `cursorOf` in
 * ingestionPullLifecycle.ts still stringifies an object-shaped cursor, which
 * only makes sense if object-shaped rows exist. So the question asked is
 * whether there is any content, which answers correctly for the string and
 * JSON-null cases the writer produces *and* for the object case it does not.
 *
 * The two shapes have to agree, because `cursorOf` turns one into the other:
 * an empty object read straight from the column answers "no cursor", and the
 * same empty object after a round trip through `cursorOf` arrives as the
 * string "{}". Reading content out of the serialized form rather than out of
 * its length is what keeps those two answers the same, while leaving an opaque
 * page token — a string and nothing more — answering "yes".
 *
 * Getting this wrong is quiet in both directions: answer "yes" for a source
 * that never pulled and an editable backfill start disappears; answer "no" for
 * one that did and the form accepts a start the usage cursor will ignore,
 * because that cursor deliberately never rewinds.
 *
 * It lives here rather than beside its first caller because it now has two:
 * the DTO that decides what the form offers, and the update path that refuses
 * a report change once a cursor exists. A second copy of this predicate is how
 * those two would come to disagree about what "has pulled" means.
 */
export function hasPollerCursor(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return hasContentAsCursorString(value);
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

/**
 * A cursor string carries content unless it is empty, or it is the
 * serialization of something that carries none. An opaque page token is not
 * JSON and keeps its "yes" by falling through the parse.
 */
function hasContentAsCursorString(value: string): boolean {
  if (value.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed == null) return false;
    if (typeof parsed === "object") return Object.keys(parsed).length > 0;
    return true;
  } catch {
    return true;
  }
}
