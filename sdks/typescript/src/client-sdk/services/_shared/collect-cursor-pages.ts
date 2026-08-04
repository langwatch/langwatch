/**
 * The walk that turns a cursor-paginated endpoint back into a whole listing.
 *
 * The gateway platform lists serve one page plus a `next_cursor` that is null
 * exactly when the walk is exhausted. Two things about that contract are easy
 * to get wrong in a hand-rolled loop, and both lose rows silently:
 *
 * - A FULL page does not mean there is more, and a SHORT page does not mean
 *   there is no more. `/virtual-keys` filters each page for visibility after
 *   reading it, so a page of 3 can still be followed by a page of 200. The
 *   null cursor is the only end-of-walk signal.
 * - A cursor the endpoint did not issue answers 400 `invalid_cursor` rather
 *   than restarting the walk, so cursors must be passed back verbatim.
 */

/**
 * The page size a walk asks for. The wire caps `limit` at 200 and defaults to
 * 50; a complete walk is four times fewer round trips at the cap.
 */
export const CURSOR_WALK_PAGE_SIZE = 200;

/**
 * More pages than any real listing has, and therefore evidence of a cursor
 * chain that never ends. Raising beats stopping here: a silent stop is the
 * truncation the walk exists to prevent.
 */
export const MAX_CURSOR_WALK_PAGES = 1000;

/**
 * Read every page of a cursor-paginated list, in order.
 *
 * Returns the pages rather than the rows so the caller can fold whatever else
 * rides on each page (a `spend_available` flag, say) instead of losing it.
 */
export async function collectCursorPages<TPage>(options: {
  /** Reads one page. `undefined` asks for the first. */
  fetchPage: (cursor: string | undefined) => Promise<TPage>;
  /** Absent and null both mean the walk is exhausted. */
  nextCursorOf: (page: TPage) => string | null | undefined;
  /** Resumes an interrupted walk instead of starting from the first row. */
  startCursor?: string;
  /** Raised when the endpoint's cursor chain never reaches an end. */
  onEndlessWalk: (reason: string) => Error;
}): Promise<TPage[]> {
  const pages: TPage[] = [];
  const served = new Set<string>();
  let cursor = options.startCursor;

  for (;;) {
    const page = await options.fetchPage(cursor);
    pages.push(page);

    // A server that predates cursor pagination on this route sends no
    // `next_cursor` at all; absent reads the same as exhausted.
    const next = options.nextCursorOf(page) ?? null;
    if (next === null) return pages;

    // A cursor served twice walks the same page forever.
    if (served.has(next)) {
      throw options.onEndlessWalk(
        "the endpoint served the same page cursor twice, so the walk cannot advance",
      );
    }
    if (pages.length >= MAX_CURSOR_WALK_PAGES) {
      throw options.onEndlessWalk(
        `the walk passed ${MAX_CURSOR_WALK_PAGES} pages without the cursor coming back null`,
      );
    }

    served.add(next);
    cursor = next;
  }
}
